require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/medisync_clinic_management";

// ================= MIDDLEWARE =================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static("public"));

// ================= ONLINE APPOINTMENT MODEL =================

const appointmentSchema = new mongoose.Schema(
  {
    patientName: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    department: {
      type: String,
      required: true,
      trim: true,
    },
    doctor: {
      type: String,
      required: true,
      trim: true,
    },
    appointmentDate: {
      type: String,
      required: true,
    },
    appointmentTime: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["Booked", "Completed", "Cancelled"],
      default: "Booked",
    },
    tokenNumber: Number,
    tokenLabel: String,
  },
  { timestamps: true },
);

const OnlineAppointment = mongoose.model(
  "OnlineAppointment",
  appointmentSchema,
  "onlineappointments",
);

// Reception ki appointments collection read karne ke liye
const ReceptionAppointment = mongoose.model(
  "ReceptionAppointment",
  new mongoose.Schema(
    {},
    {
      strict: false,
      collection: "appointments",
    },
  ),
);

// ================= EXISTING DOCTORS COLLECTION =================

const doctorSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    collection: "doctors",
  },
);

const Doctor = mongoose.model("Doctor", doctorSchema);

// ================= HELPERS =================

const isDatabaseConnected = () => mongoose.connection.readyState === 1;

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

const today = () => {
  const date = new Date();

  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const nextToken = async (appointmentDate) => {
  const [onlineLast, receptionLast] = await Promise.all([
    OnlineAppointment.findOne({
      appointmentDate,
    })
      .sort({ tokenNumber: -1 })
      .select("tokenNumber")
      .lean(),

    ReceptionAppointment.findOne({
      date: appointmentDate,
    })
      .sort({ tokenNumber: -1 })
      .select("tokenNumber")
      .lean(),
  ]);

  const onlineToken = Number(onlineLast?.tokenNumber || 0);
  const receptionToken = Number(receptionLast?.tokenNumber || 0);

  const next = Math.max(onlineToken, receptionToken) + 1;

  console.log("========== TOKEN DEBUG ==========");
  console.log("Database:", mongoose.connection.name);
  console.log("Appointment date:", appointmentDate);
  console.log("Online last token:", onlineToken);
  console.log("Reception last token:", receptionToken);
  console.log("Generated next token:", next);
  console.log("=================================");

  return next;
};
// ================= HEALTH CHECK =================

app.get("/api/health", (req, res) => {
  res.json({
    app: "MediSync Website",
    status: "running",
    database: isDatabaseConnected() ? "connected" : "disconnected",
    databaseName: mongoose.connection.name,
    appointmentCollection: "onlineappointments",
    doctorCollection: "doctors",
  });
});

// ================= GET DOCTORS FROM DATABASE =================

app.get("/api/doctors", async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({
        message: "Database is not connected.",
      });
    }

    const doctors = await Doctor.find({
      active: { $ne: false },
      name: { $exists: true, $ne: "" },
    })
      .select("name specialization")
      .sort({ name: 1 })
      .lean();

    return res.json(
      doctors.map((doctor) => ({
        _id: doctor._id,
        name: doctor.name,
        specialization: doctor.specialization || "",
      })),
    );
  } catch (error) {
    console.error("Unable to fetch doctors:", error);

    return res.status(500).json({
      message: "Doctors could not be loaded.",
    });
  }
});

// ================= BOOK ONLINE APPOINTMENT =================

app.post("/api/appointments", async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({
        message: "Database is not connected. Please try again later.",
      });
    }

    const {
      patientName,
      phone,
      email,
      department,
      doctor,
      appointmentDate,
      appointmentTime,
      reason,
    } = req.body || {};

    if (
      typeof patientName !== "string" ||
      !patientName.trim() ||
      typeof phone !== "string" ||
      !phone.trim() ||
      typeof department !== "string" ||
      !department.trim() ||
      typeof doctor !== "string" ||
      !doctor.trim() ||
      !appointmentDate ||
      !appointmentTime
    ) {
      return res.status(400).json({
        message: "Please fill all required fields.",
      });
    }

    if (!isValidDate(appointmentDate) || appointmentDate < today()) {
      return res.status(400).json({
        message: "Please select today or a future appointment date.",
      });
    }
    const doctorRecord = await Doctor.findOne({
      name: doctor.trim(),
      active: { $ne: false },
    })
      .select("name specialization")
      .lean();

    if (!doctorRecord) {
      return res.status(400).json({
        message:
          "Selected doctor is unavailable. Please choose another doctor.",
      });
    }

    // Duplicate online slot check.
    const existing = await OnlineAppointment.findOne({
      doctor: doctorRecord.name,
      appointmentDate,
      appointmentTime,
      status: { $ne: "Cancelled" },
    }).lean();

    if (existing) {
      return res.status(409).json({
        message: "This doctor's time slot is already booked.",
      });
    }

    const tokenNumber = await nextToken(appointmentDate);

    const appointment = await OnlineAppointment.create({
      patientName: patientName.trim(),
      phone: phone.trim(),
      email: String(email || "")
        .trim()
        .toLowerCase(),
      department: department.trim(),
      doctor: doctorRecord.name,
      appointmentDate,
      appointmentTime,
      reason: String(reason || "").trim(),
      status: "Booked",
      tokenNumber,
      tokenLabel: `T-${String(tokenNumber).padStart(3, "0")}`,
    });

    return res.status(201).json({
      message: "Appointment booked successfully.",
      appointment: {
        _id: appointment._id,
        patientName: appointment.patientName,
        doctor: appointment.doctor,
        department: appointment.department,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        tokenNumber: appointment.tokenNumber,
        tokenLabel: appointment.tokenLabel,
        status: appointment.status,
      },
    });
  } catch (error) {
    console.error("Online appointment booking failed:", error);

    return res.status(500).json({
      message: "Appointment could not be saved. Please try again.",
    });
  }
});

// ================= GET ONLINE APPOINTMENTS =================

app.get("/api/appointments", async (req, res) => {
  try {
    if (!isDatabaseConnected()) {
      return res.status(503).json({
        message: "Database is not connected.",
      });
    }

    const appointments = await OnlineAppointment.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json(appointments);
  } catch (error) {
    console.error("Unable to fetch online appointments:", error);

    return res.status(500).json({
      message: "Online appointments could not be loaded.",
    });
  }
});

// ================= UPDATE ONLINE APPOINTMENT STATUS =================

app.patch("/api/appointments/:id/status", async (req, res) => {
  try {
    const allowedStatuses = ["Booked", "Completed", "Cancelled"];

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid appointment ID.",
      });
    }

    if (!allowedStatuses.includes(req.body.status)) {
      return res.status(400).json({
        message: "Invalid appointment status.",
      });
    }

    const appointment = await OnlineAppointment.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true },
    );

    if (!appointment) {
      return res.status(404).json({
        message: "Online appointment not found.",
      });
    }

    return res.json({
      message: "Online appointment status updated.",
      appointment,
    });
  } catch (error) {
    console.error("Status update failed:", error);

    return res.status(500).json({
      message: "Could not update appointment status.",
    });
  }
});

// ================= CONTACT EMAIL =================

const transport = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

app.post("/contact", async (req, res) => {
  try {
    const { name, email, phone, category, message } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return res.status(400).send("Please complete the required fields.");
    }

    await transport.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      replyTo: email.trim(),
      subject: "MediSync contact: " + name.trim(),
      text:
        `Name: ${name}\n` +
        `Email: ${email}\n` +
        `Phone: ${phone || ""}\n` +
        `Category: ${category || ""}\n` +
        `Message: ${message}`,
    });

    return res.redirect("/contact?success=1");
  } catch (error) {
    console.error("Contact form error:", error);

    return res.redirect("/contact?error=1");
  }
});

// ================= WEBSITE FALLBACK =================

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      message: "API route not found.",
    });
  }

  if (req.method !== "GET") {
    return res.status(404).send("Page not found.");
  }

  res.sendFile(path.join(__dirname, "public", "index.html"), (error) => {
    if (error && !res.headersSent) {
      next(error);
    }
  });
});

// ================= ERROR HANDLER =================

app.use((error, req, res, next) => {
  console.error("Server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    message: "An unexpected server error occurred.",
  });
});

// ================= START SERVER =================

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);

    console.log("MongoDB connected.");
    console.log("Database:", mongoose.connection.name);
    console.log("Appointment collection: onlineappointments");
    console.log("Doctor collection: doctors");

    app.listen(PORT, () => {
      console.log(`MediSync running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exitCode = 1;
  }
}

startServer();
