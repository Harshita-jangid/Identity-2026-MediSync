require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const URI =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/medisync_clinic_management";

// ==================== MIDDLEWARE ====================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "local-demo-change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 28800000,
    },
  }),
);

app.use((req, res, next) => {
  res.locals.admin = req.session.admin || null;
  res.locals.notice = req.query.success || "";
  next();
});

// ==================== MODELS ====================

const Patient = mongoose.model(
  "Patient",
  new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true },
      age: { type: Number, min: 0, max: 120, required: true },
      gender: {
        type: String,
        enum: ["Female", "Male", "Other"],
        required: true,
      },
      phone: { type: String, required: true, trim: true },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
      medicalNotes: { type: String, default: "" },
    },
    { timestamps: true },
  ),
);

const Doctor = mongoose.model(
  "Doctor",
  new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true },
      specialization: { type: String, required: true, trim: true },
      phone: String,
      room: String,
      active: { type: Boolean, default: true },
    },
    { timestamps: true },
  ),
);

const Appointment = mongoose.model(
  "Appointment",
  new mongoose.Schema(
    {
      patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Patient",
        required: true,
      },
      doctor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Doctor",
        required: true,
      },
      date: { type: String, required: true },
      time: { type: String, required: true },
      reason: { type: String, default: "" },
      status: {
        type: String,
        enum: [
          "Booked",
          "Waiting",
          "In Consultation",
          "Completed",
          "Cancelled",
        ],
        default: "Waiting",
      },
      tokenNumber: { type: Number, required: true },
      tokenLabel: { type: String, required: true },

      // Appointment ka source track karega
      source: {
        type: String,
        enum: ["online", "reception"],
        default: "reception",
      },
    },
    { timestamps: true },
  ),
);

const OnlineAppointment = mongoose.model(
  "OnlineAppointment",
  new mongoose.Schema(
    {
      patientName: { type: String, required: true, trim: true },
      age: { type: Number, min: 0, max: 120 },
      gender: { type: String, enum: ["Female", "Male", "Other"] },
      phone: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true },
      doctor: { type: String, required: true },
      department: { type: String, required: true },
      appointmentDate: { type: String, required: true },
      appointmentTime: { type: String, required: true },
      reason: { type: String, default: "" },
      status: {
        type: String,
        enum: [
          "Booked",
          "Waiting",
          "In Consultation",
          "Completed",
          "Cancelled",
        ],
        default: "Booked",
      },
      tokenNumber: { type: Number, required: true },
      tokenLabel: { type: String, required: true },
    },
    { timestamps: true },
  ),
  "onlineappointments",
);
// ==================== HELPERS ====================

const ar = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const auth = (req, res, next) =>
  req.session.admin
    ? next()
    : res.redirect("/admin/login?next=" + encodeURIComponent(req.originalUrl));

const doctorAuth = (req, res, next) =>
  req.session.doctorUser
    ? next()
    : res.redirect("/doctor/login?next=" + encodeURIComponent(req.originalUrl));

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const validDate = (date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) &&
  !Number.isNaN(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;

const err = (res, status, title, message) =>
  res.status(status).render("error", { title, message });

const nextToken = async (date) => {
  const [receptionLast, onlineLast] = await Promise.all([
    Appointment.findOne({ date })
      .sort({ tokenNumber: -1 })
      .select("tokenNumber")
      .lean(),

    OnlineAppointment.findOne({
      appointmentDate: date,
    })
      .sort({ tokenNumber: -1 })
      .select("tokenNumber")
      .lean(),
  ]);

  const receptionToken = Number(receptionLast?.tokenNumber || 0);
  const onlineToken = Number(onlineLast?.tokenNumber || 0);

  return Math.max(receptionToken, onlineToken) + 1;
};

// ==================== DOCTOR LOGIN ====================

app.get("/doctor/login", (req, res) =>
  req.session.doctorUser
    ? res.redirect("/doctor/panel")
    : res.render("doctor-login", { title: "Doctor Login", errorMessage: "" }),
);
app.post(
  "/doctor/login",
  ar(async (req, res) => {
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");
    const expected = process.env.DOCTOR_PORTAL_PASSWORD || "Doctor@123";
    const d = await Doctor.findOne({ phone, active: true });
    if (!d || password !== expected)
      return res.status(401).render("doctor-login", {
        title: "Doctor Login",
        errorMessage:
          "Invalid phone number/password, or doctor account is inactive.",
      });
    req.session.doctorUser = { id: String(d._id), name: d.name };
    res.redirect("/doctor/panel");
  }),
);
app.post("/doctor/logout", (req, res, next) => {
  delete req.session.doctorUser;
  req.session.save((e) =>
    e ? next(e) : res.redirect("/doctor/login?success=logged-out"),
  );
});
// app.get(
//   "/doctor/panel",
//   doctorAuth,
//   ar(async (req, res) => {
//     const d = await Doctor.findById(req.session.doctorUser.id);
//     if (!d || !d.active) {
//       delete req.session.doctorUser;
//       return res.redirect("/doctor/login");
//     }
//     const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ""))
//       ? req.query.date
//       : today();
//     const q = String(req.query.q || "").trim();
//     let appointments = await Appointment.find({ doctor: d._id, date })
//       .populate("patient")
//       .sort({ time: 1, tokenNumber: 1 });
//     if (q) {
//       const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
//       appointments = appointments.filter(
//         (a) =>
//           re.test(a.patient?.name || "") ||
//           re.test(a.patient?.phone || "") ||
//           re.test(a.tokenLabel || ""),
//       );
//     }
//     res.render("doctor-panel", {
//       title: "Doctor Panel",
//       doctor: d,
//       appointments,
//       date,
//       q,
//     });
//   }),
// );

app.get(
  "/doctor/panel",
  doctorAuth,
  ar(async (req, res) => {
    const doctor = await Doctor.findById(req.session.doctorUser.id);

    if (!doctor || !doctor.active) {
      delete req.session.doctorUser;
      return res.redirect("/doctor/login");
    }

    const requestedDate = String(req.query.date || "");
    const date = validDate(requestedDate) ? requestedDate : today();
    const q = String(req.query.q || "").trim();

    const [receptionAppointments, onlineAppointments] = await Promise.all([
      Appointment.find({
        doctor: doctor._id,
        date,
      })
        .populate("patient")
        .lean(),

      OnlineAppointment.find({
        doctor: doctor.name,
        appointmentDate: date,
      }).lean(),
    ]);

    const receptionData = receptionAppointments.map((a) => ({
      ...a,
      patientName: a.patient?.name || "Deleted patient",
      patientPhone: a.patient?.phone || "",
      patientAge: a.patient?.age ?? "—",
      displayTime: a.time || "",
      source: "Reception",
    }));

    const onlineData = onlineAppointments.map((a) => ({
      ...a,
      patientName: a.patientName || "Unknown patient",
      patientPhone: a.phone || "",
      patientAge: a.age ?? "—",
      displayTime: a.appointmentTime || "",
      source: "Online",
    }));

    let appointments = [...receptionData, ...onlineData];

    appointments.sort(
      (a, b) =>
        String(a.displayTime).localeCompare(String(b.displayTime)) ||
        (Number(a.tokenNumber) || 0) - (Number(b.tokenNumber) || 0),
    );

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const search = new RegExp(escaped, "i");

      appointments = appointments.filter(
        (a) =>
          search.test(a.patientName || "") ||
          search.test(a.patientPhone || "") ||
          search.test(a.tokenLabel || ""),
      );
    }

    res.render("doctor-panel", {
      title: "Doctor Panel",
      doctor,
      appointments,
      date,
      q,
    });
  }),
);
app.post(
  "/doctor/appointments/:id/status",
  doctorAuth,
  ar(async (req, res) => {
    const allowed = ["Waiting", "In Consultation", "Completed", "Cancelled"];
    if (!allowed.includes(req.body.status))
      return err(
        res,
        400,
        "Invalid status",
        "Choose a valid appointment status.",
      );
    const a = await Appointment.findOne({
      _id: req.params.id,
      doctor: req.session.doctorUser.id,
    });
    if (!a)
      return err(
        res,
        404,
        "Appointment not found",
        "This appointment does not belong to your doctor account.",
      );
    a.status = req.body.status;
    await a.save();
    res.redirect(
      "/doctor/panel?date=" +
        encodeURIComponent(a.date) +
        "&success=Appointment+updated",
    );
  }),
);

// ==================== ADMIN LOGIN ====================

app.get("/admin/login", (req, res) =>
  req.session.admin
    ? res.redirect("/")
    : res.render("login", {
        title: "Admin Login",
        errorMessage: "",
        next: req.query.next || "/",
      }),
);

app.post("/admin/login", (req, res) => {
  if (
    String(req.body.username || "") !==
      (process.env.ADMIN_USERNAME || "admin") ||
    String(req.body.password || "") !==
      (process.env.ADMIN_PASSWORD || "admin1234")
  ) {
    return res.status(401).render("login", {
      title: "Admin Login",
      errorMessage: "Incorrect username or password.",
      next: req.body.next || "/",
    });
  }

  req.session.regenerate((e) => {
    if (e) {
      return err(res, 500, "Login error", "Could not start session.");
    }

    req.session.admin = { username: req.body.username };

    const nextUrl = String(req.body.next || "/");
    res.redirect(
      nextUrl.startsWith("/") && !nextUrl.startsWith("//") ? nextUrl : "/",
    );
  });
});

app.post("/admin/logout", (req, res, next) =>
  req.session.destroy((e) =>
    e
      ? next(e)
      : (res.clearCookie("connect.sid"),
        res.redirect("/admin/login?success=logged-out")),
  ),
);

// ==================== DASHBOARD ====================

app.get(
  "/",
  auth,
  ar(async (req, res) => {
    const t = today();

    const [patients, doctors, total, todays, waiting, recent] =
      await Promise.all([
        Patient.countDocuments(),
        Doctor.countDocuments({ active: true }),
        Appointment.countDocuments(),
        Appointment.countDocuments({
          date: t,
          status: { $nin: ["Completed", "Cancelled"] },
        }),
        Appointment.countDocuments({
          date: t,
          status: { $in: ["Waiting", "Booked"] },
        }),
        Appointment.find()
          .populate("patient doctor")
          .sort({ date: -1, time: 1 })
          .limit(8),
      ]);

    res.render("dashboard", {
      title: "Dashboard",
      patients,
      doctors,
      total,
      todays,
      waiting,
      recent,
      t,
    });
  }),
);

// ==================== PATIENTS ====================

app.get(
  "/patients",
  auth,
  ar(async (req, res) => {
    const q = String(req.query.q || "").trim();

    const filter = q
      ? {
          $or: [
            { name: { $regex: q, $options: "i" } },
            { phone: { $regex: q, $options: "i" } },
          ],
        }
      : {};

    res.render("patients", {
      title: "Patients",
      patients: await Patient.find(filter).sort({ createdAt: -1 }),
      q,
    });
  }),
);

app.get("/patients/new", auth, (req, res) =>
  res.render("patient-form", {
    title: "Register Patient",
    patient: {},
    action: "/patients",
    submitLabel: "Save Patient",
  }),
);

app.post(
  "/patients",
  auth,
  ar(async (req, res) => {
    const b = req.body;

    await Patient.create({
      name: b.name,
      age: Number(b.age),
      gender: b.gender,
      phone: b.phone,
      email: b.email,
      address: b.address,
      medicalNotes: b.medicalNotes,
    });

    res.redirect("/patients?success=Patient+registered");
  }),
);

app.get(
  "/patients/:id/edit",
  auth,
  ar(async (req, res) => {
    const p = await Patient.findById(req.params.id);

    if (!p) {
      return err(
        res,
        404,
        "Patient not found",
        "Patient record does not exist.",
      );
    }

    res.render("patient-form", {
      title: "Edit Patient",
      patient: p,
      action: `/patients/${p._id}/edit`,
      submitLabel: "Update Patient",
    });
  }),
);

app.post(
  "/patients/:id/edit",
  auth,
  ar(async (req, res) => {
    const b = req.body;

    const p = await Patient.findByIdAndUpdate(
      req.params.id,
      {
        name: b.name,
        age: Number(b.age),
        gender: b.gender,
        phone: b.phone,
        email: b.email,
        address: b.address,
        medicalNotes: b.medicalNotes,
      },
      { new: true, runValidators: true },
    );

    if (!p) {
      return err(
        res,
        404,
        "Patient not found",
        "Patient record does not exist.",
      );
    }

    res.redirect("/patients?success=Patient+updated");
  }),
);

app.post(
  "/patients/:id/delete",
  auth,
  ar(async (req, res) => {
    await Appointment.deleteMany({ patient: req.params.id });
    await Patient.findByIdAndDelete(req.params.id);

    res.redirect("/patients?success=Patient+deleted");
  }),
);

app.get(
  "/patients/:id",
  auth,
  ar(async (req, res) => {
    const p = await Patient.findById(req.params.id);

    if (!p) {
      return err(
        res,
        404,
        "Patient not found",
        "Patient record does not exist.",
      );
    }

    const appointments = await Appointment.find({ patient: p._id })
      .populate("doctor")
      .sort({ date: -1, time: -1 });

    res.render("patient-detail", {
      title: "Patient Record",
      patient: p,
      appointments,
    });
  }),
);

// ==================== DOCTORS ====================

app.get(
  "/doctors",
  auth,
  ar(async (req, res) => {
    res.render("doctors", {
      title: "Doctors",
      doctors: await Doctor.find().sort({ active: -1, name: 1 }),
    });
  }),
);

app.post(
  "/doctors",
  auth,
  ar(async (req, res) => {
    await Doctor.create({
      name: req.body.name,
      specialization: req.body.specialization,
      phone: req.body.phone,
      room: req.body.room,
    });

    res.redirect("/doctors?success=Doctor+added");
  }),
);

app.post(
  "/doctors/:id/toggle",
  auth,
  ar(async (req, res) => {
    const d = await Doctor.findById(req.params.id);

    if (!d) {
      return err(res, 404, "Doctor not found", "Doctor record does not exist.");
    }

    d.active = !d.active;
    await d.save();

    res.redirect("/doctors?success=Doctor+status+updated");
  }),
);

app.post(
  "/doctors/:id/delete",
  auth,
  ar(async (req, res) => {
    const activeAppointment = await Appointment.exists({
      doctor: req.params.id,
      status: { $nin: ["Completed", "Cancelled"] },
    });

    if (activeAppointment) {
      return res.redirect("/doctors?success=Doctor+has+active+appointments");
    }

    await Doctor.findByIdAndDelete(req.params.id);
    res.redirect("/doctors?success=Doctor+deleted");
  }),
);

// ==================== RECEPTION APPOINTMENTS ====================

// app.get(
//   "/appointments",
//   auth,
//   ar(async (req, res) => {
//     const [appointments, patients, doctors] = await Promise.all([
//       Appointment.find()
//         .populate("patient doctor")
//         .sort({ date: -1, time: 1 }),
//       Patient.find().sort({ name: 1 }),
//       Doctor.find({ active: true }).sort({ name: 1 }),
//     ]);

//     res.render("appointments", {
//       title: "Appointments",
//       appointments,
//       patients,
//       doctors,
//       t: today(),
//     });
//   }),
// );

// ==================== RECEPTION APPOINTMENTS ====================

app.get(
  "/appointments",
  auth,
  ar(async (req, res) => {
    const requestedDate = String(req.query.date || "");
    const date = validDate(requestedDate) ? requestedDate : today();

    const [receptionAppointments, onlineAppointments, patients, doctors] =
      await Promise.all([
        // Reception se book ki gayi appointments
        Appointment.find({ date }).populate("patient doctor").lean(),

        // Website se book ki gayi appointments
        OnlineAppointment.find({
          appointmentDate: date,
          status: { $ne: "Cancelled" },
        }).lean(),
        Patient.find().sort({ name: 1 }).lean(),

        Doctor.find({ active: true }).sort({ name: 1 }).lean(),
      ]);

    // Reception appointments ka display format
    const receptionData = receptionAppointments.map((a) => ({
      ...a,
      patientName: a.patient?.name || "Deleted patient",
      doctorName: a.doctor?.name || "Deleted doctor",
      displayDate: a.date,
      displayTime: a.time,
      source: "Reception",
    }));

    // Online appointments ka display format
    const onlineData = onlineAppointments.map((a) => ({
      ...a,
      patientName: a.patientName || "Unknown patient",
      doctorName: a.doctor || "Unknown doctor",
      displayDate: a.appointmentDate,
      displayTime: a.appointmentTime,
      source: "Online",
    }));
    // Dono collections ka data combine karo
    const appointments = [...receptionData, ...onlineData].sort((a, b) => {
      const timeComparison = String(a.displayTime || "").localeCompare(
        String(b.displayTime || ""),
      );

      return (
        timeComparison ||
        (Number(a.tokenNumber) || 0) - (Number(b.tokenNumber) || 0)
      );
    });

    console.log("Selected date:", date);
    console.log("Reception appointments:", receptionAppointments.length);
    console.log("Online appointments:", onlineAppointments.length);

    res.render("appointments", {
      title: "Appointments",
      appointments,
      patients,
      doctors,
      date,
      t: today(),
    });
  }),
);

app.post(
  "/appointments",
  auth,
  ar(async (req, res) => {
    const { patient, doctor, date, time, reason } = req.body;

    if (!patient || !doctor || !date || !time) {
      return err(res, 400, "Missing details", "Complete all required fields.");
    }

    if (!validDate(date) || date < today()) {
      return err(res, 400, "Invalid date", "Choose today or a future date.");
    }

    const [p, d] = await Promise.all([
      Patient.exists({ _id: patient }),
      Doctor.exists({ _id: doctor, active: true }),
    ]);

    if (!p || !d) {
      return err(
        res,
        400,
        "Invalid selection",
        "Choose an existing patient and active doctor.",
      );
    }

    const existing = await Appointment.exists({
      doctor,
      date,
      time,
      status: { $nin: ["Cancelled", "Completed"] },
    });

    if (existing) {
      return err(
        res,
        409,
        "Time slot unavailable",
        "This doctor already has an active appointment at this date and time.",
      );
    }

    const tokenNumber = await nextToken(date);

    await Appointment.create({
      patient,
      doctor,
      date,
      time,
      reason,
      tokenNumber,
      tokenLabel: "T-" + String(tokenNumber).padStart(3, "0"),
      status: "Waiting",
      source: "reception",
    });

    res.redirect(
      "/queue?date=" + encodeURIComponent(date) + "&success=Appointment+booked",
    );
  }),
);

app.post(
  "/online-appointments/:id/status",
  auth,
  ar(async (req, res) => {
    const allowedStatuses = [
      "Waiting",
      "Booked",
      "In Consultation",
      "Completed",
      "Cancelled",
    ];

    const status = req.body.status;

    if (!allowedStatuses.includes(status)) {
      return res.status(400).send("Invalid appointment status");
    }

    const appointment = await OnlineAppointment.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true, runValidators: true },
    );

    if (!appointment) {
      return res.status(404).send("Online appointment not found");
    }

    res.redirect("/appointments");
  }),
);

// // ==================== WEBSITE APPOINTMENT BOOKING ====================

// app.post(
//   "/api/appointments",
//   ar(async (req, res) => {
//     if (mongoose.connection.readyState !== 1) {
//       return res.status(503).json({
//         message: "Database connected nahi hai.",
//       });
//     }

//     const {
//       patientName,
//       age,
//       gender,
//       phone,
//       email,
//       doctor,
//       department,
//       appointmentDate,
//       appointmentTime,
//       reason,
//     } = req.body || {};

//     if (
//       !patientName?.trim() ||
//       !phone?.trim() ||
//       !email?.trim() ||
//       !doctor?.trim() ||
//       !department?.trim() ||
//       !appointmentDate ||
//       !appointmentTime
//     ) {
//       return res.status(400).json({
//         message: "Please fill all required fields.",
//       });
//     }

//     if (!validDate(appointmentDate) || appointmentDate < today()) {
//       return res.status(400).json({
//         message: "Choose today or a future appointment date.",
//       });
//     }

//     // Doctor name aur specialization dono verify karo
//     const doctorRecord = await Doctor.findOne({
//       name: doctor.trim(),
//       specialization: department.trim(),
//       active: true,
//     });

//     if (!doctorRecord) {
//       return res.status(400).json({
//         message: "Selected doctor ya department clinic database mein nahi mila.",
//       });
//     }

//     // Existing patient ko phone se identify karo
//     let patientRecord = await Patient.findOne({
//       phone: phone.trim(),
//     });

//     // New patient ke liye age aur gender required hain
//     if (!patientRecord) {
//       if (
//         age === undefined ||
//         age === "" ||
//         !Number.isFinite(Number(age)) ||
//         Number(age) < 0 ||
//         Number(age) > 120 ||
//         !["Female", "Male", "Other"].includes(gender)
//       ) {
//         return res.status(400).json({
//           message: "New patient ke liye valid age aur gender required hain.",
//         });
//       }

//       patientRecord = await Patient.create({
//         name: patientName.trim(),
//         age: Number(age),
//         gender,
//         phone: phone.trim(),
//         email: email.trim().toLowerCase(),
//         address: "",
//         medicalNotes: "",
//       });
//     }

//     // Same doctor ke same time slot ko dobara book nahi hone dena
//     const existing = await Appointment.exists({
//       doctor: doctorRecord._id,
//       date: appointmentDate,
//       time: appointmentTime,
//       status: { $nin: ["Cancelled", "Completed"] },
//     });

//     if (existing) {
//       return res.status(409).json({
//         message: "This doctor's slot is already booked.",
//       });
//     }

//     const tokenNumber = await nextToken(appointmentDate);

//     const appointment = await OnlineAppointment.create({
//   patientName: patientName.trim(),
//   age: age ? Number(age) : undefined,
//   gender: gender || undefined,
//   phone: phone.trim(),
//   email: email.trim().toLowerCase(),
//   doctor: doctorRecord.name,
//   department: doctorRecord.specialization,
//   date: appointmentDate,
//   time: appointmentTime,
//   reason: (reason || "").trim(),
//   status: "Booked",
//   tokenNumber,
//   tokenLabel: `T-${String(tokenNumber).padStart(3, "0")}`,
// });

//     return res.status(201).json({
//       message: "Appointment booked successfully!",
//       appointment: {
//         _id: appointment._id,
//         tokenNumber: appointment.tokenNumber,
//         tokenLabel: appointment.tokenLabel,
//       },
//     });
//   }),
// );

// ==================== ONLINE APPOINTMENTS PAGE ====================

app.get(
  "/online-appointments",
  auth,
  ar(async (req, res) => {
    const appointments = await OnlineAppointment.find()
      .sort({ createdAt: -1 })
      .lean();

    res.render("online-appointments", {
      title: "Online Appointments",
      appointments,
    });
  }),
);

// JSON API: online appointments
app.get(
  "/api/online-appointments",
  auth,
  ar(async (req, res) => {
    const appointments = await OnlineAppointment.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(appointments);
  }),
);

// ==================== APPOINTMENT STATUS ====================

app.post(
  "/appointments/:id/status",
  auth,
  ar(async (req, res) => {
    const allowedStatuses = [
      "Booked",
      "Waiting",
      "In Consultation",
      "Completed",
      "Cancelled",
    ];

    if (!allowedStatuses.includes(req.body.status)) {
      return err(res, 400, "Invalid status", "Status is not valid.");
    }

    const a = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true },
    );

    if (!a) {
      return err(
        res,
        404,
        "Appointment not found",
        "Appointment does not exist.",
      );
    }

    res.redirect("/appointments?success=Appointment+updated");
  }),
);

// ==================== OPD QUEUE ====================

// app.get(
//   "/queue",
//   auth,
//   ar(async (req, res) => {
//     const requestedDate = String(req.query.date || "");
//     const date = validDate(requestedDate) ? requestedDate : today();

//     const appointments = await Appointment.find({
//       date,
//       status: { $ne: "Cancelled" },
//     })
//       .populate("patient doctor")
//       .sort({ tokenNumber: 1 });

//     res.render("queue", {
//       title: "OPD Live Queue",
//       appointments,
//       date,
//       t: today(),
//     });
//   }),
// );\

app.get(
  "/queue",
  auth,
  ar(async (req, res) => {
    const requestedDate = String(req.query.date || "");
    const date = validDate(requestedDate) ? requestedDate : today();

    const [receptionAppointments, onlineAppointments] = await Promise.all([
      Appointment.find({
        date,
        status: { $nin: ["Completed", "Cancelled"] },
      })
        .populate("patient doctor")
        .lean(),

      OnlineAppointment.find({
        appointmentDate: date,
        status: { $nin: ["Completed", "Cancelled"] },
      }).lean(),
    ]);

    const receptionData = receptionAppointments.map((a) => ({
      ...a,
      patientName: a.patient?.name || "Deleted patient",
      doctorName: a.doctor?.name || "Deleted doctor",
      specialization: a.doctor?.specialization || "",
      displayTime: a.time || "",
      source: "Reception",
    }));

    const onlineData = onlineAppointments.map((a) => ({
      ...a,
      patientName: a.patientName || "Unknown patient",
      doctorName: a.doctor || "Unknown doctor",
      specialization: a.department || "",
      displayTime: a.appointmentTime || "",
      source: "Online",
    }));

    const appointments = [...receptionData, ...onlineData].sort((a, b) => {
      return (
        String(a.displayTime).localeCompare(String(b.displayTime)) ||
        (Number(a.tokenNumber) || 0) - (Number(b.tokenNumber) || 0)
      );
    });

    res.render("queue", {
      title: "OPD Live Queue",
      appointments,
      date,
      t: today(),
    });
  }),
);

app.post(
  "/queue/:id/action",
  auth,
  ar(async (req, res) => {
    const transitions = {
      call: {
        from: ["Waiting", "Booked"],
        to: "In Consultation",
      },
      waiting: {
        from: ["In Consultation"],
        to: "Waiting",
      },
      complete: {
        from: ["In Consultation"],
        to: "Completed",
      },
      cancel: {
        from: ["Waiting", "Booked"],
        to: "Cancelled",
      },
    };

    const action = transitions[req.body.action];
    const a = await Appointment.findById(req.params.id);

    if (!a) {
      return err(
        res,
        404,
        "Appointment not found",
        "Appointment does not exist.",
      );
    }

    if (!action) {
      return err(res, 400, "Invalid action", "Queue action is invalid.");
    }

    if (!action.from.includes(a.status)) {
      return err(
        res,
        409,
        "Action not allowed",
        `Cannot apply action while status is ${a.status}.`,
      );
    }

    a.status = action.to;
    await a.save();

    res.redirect(
      "/queue?date=" + encodeURIComponent(a.date) + "&success=Queue+updated",
    );
  }),
);

// ==================== REPORTS ====================

app.get(
  "/reports",
  auth,
  ar(async (req, res) => {
    const [patients, doctors, total, completed, cancelled, waiting] =
      await Promise.all([
        Patient.countDocuments(),
        Doctor.countDocuments({ active: true }),
        Appointment.countDocuments(),
        Appointment.countDocuments({ status: "Completed" }),
        Appointment.countDocuments({ status: "Cancelled" }),
        Appointment.countDocuments({
          status: { $in: ["Booked", "Waiting", "In Consultation"] },
        }),
      ]);

    res.render("reports", {
      title: "Reports",
      patients,
      doctors,
      total,
      completed,
      cancelled,
      waiting,
    });
  }),
);
// ==================== SYSTEM-HEALTH CHECK ====================

app.get("/admin/system-health", (req, res) => {
  res.render("system-health", {
    title: "System Health",
  });
});

// ==================== HEALTH CHECK ====================

app.get("/api/health", (req, res) =>
  res.json({
    app: "MediSync Clinic Management",
    status: "running",
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  }),
);

app.get("/api/test-crash", (req, res) => {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ENABLE_CRASH_TEST !== "true"
  ) {
    return res.status(403).json({
      message: "Crash testing is disabled.",
    });
  }

  console.error("TEST: Simulating application crash.");

  // Temporary test only. PM2 should restart the process.
  setTimeout(() => process.exit(1), 100);
  res.status(200).send("Crash test triggered.");
});

// ==================== 404 + ERROR HANDLING ====================

app.use((req, res) =>
  err(res, 404, "Page not found", "The requested page does not exist."),
);

app.use((e, req, res, next) => {
  console.error(e);

  if (res.headersSent) {
    return next(e);
  }

  if (e.name === "ValidationError" || e.name === "CastError") {
    return err(res, 400, "Invalid data", "Check the submitted information.");
  }

  err(
    res,
    500,
    "Something went wrong",
    "The request could not be completed. Check the server terminal.",
  );
});

// ==================== START SERVER ====================

mongoose
  .connect(URI)
  .then(() => {
    console.log("MongoDB connected");

    app.listen(PORT, () => {
      console.log(`MediSync running at http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("MongoDB connection failed:", e.message);
    process.exitCode = 1;
  });
