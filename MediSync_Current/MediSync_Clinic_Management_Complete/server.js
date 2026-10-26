require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const crashRecordDir = path.join(__dirname, "data");
const crashRecordFile = path.join(crashRecordDir, "self-heal-crash.json");

function saveCrashRecord(record) {
  fs.mkdirSync(crashRecordDir, { recursive: true });
  fs.writeFileSync(crashRecordFile, JSON.stringify(record, null, 2), "utf8");
}

function readCrashRecord() {
  try {
    return JSON.parse(fs.readFileSync(crashRecordFile, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Crash record read failed:", err.message);
    }
    return null;
  }
}

const os = require("os");
const { execFile } = require("child_process");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const URI =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/medisync_clinic_management";

// ==================== SELF-HEALING CORE ====================
const selfHeal = {
  controls: {
    watchdog: true,
    offlineQueue: true,
    rateLimit: true,
  },
  incidents: [],
  counters: { detected: 0, recovered: 0, blocked: 0, synced: 0 },
  quarantined: [],
  startedAt: Date.now(),
};
const MAX_INCIDENTS = 100;
// ==================== DATABASE FAILURE DEMO STATE ====================

const databaseDemo = {
  failureStartedAt: null,
  recoveryStartedAt: null,
  recoveredAt: null,

  lastDowntimeMs: null,
  lastRecoveryMs: null,

  disconnecting: false,
  recovering: false,
};
// ==================== MONGODB STORAGE FAILURE ====================

const mongoStorageDemo = {
  enabled: false,
  failedAttempts: 0,
  failureStartedAt: null,
};
function logIncident(type, message, recovered = false, details = {}) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    type,
    message,
    recovered,
    details,
  };
  selfHeal.incidents.unshift(item);
  selfHeal.incidents = selfHeal.incidents.slice(0, MAX_INCIDENTS);
  selfHeal.counters.detected += 1;
  if (recovered) selfHeal.counters.recovered += 1;
  return item;
}

// Simulated MongoDB storage-full guard
function storageFullGuard(req, res, next) {
  if (!mongoStorageDemo.enabled) {
    return next();
  }

  mongoStorageDemo.failedAttempts++;

  logIncident(
    "mongodb-storage-full",
    "Appointment save rejected: simulated MongoDB storage limit reached",
    false,
    {
      path: req.originalUrl,
      method: req.method,
      failedAttempts: mongoStorageDemo.failedAttempts,
    },
  );

  // API requests receive JSON; normal form requests receive the error page.
  if (req.path.startsWith("/api/")) {
    return res.status(507).json({
      ok: false,
      code: "MONGODB_STORAGE_FULL",
      message: "MongoDB storage full. The appointment could not be saved.",
      simulated: true,
    });
  }

  return err(
    res,
    507,
    "MongoDB Storage Full",
    "The appointment could not be saved because the simulated MongoDB storage limit has been reached. Existing records have not been deleted.",
  );
}

const requestBuckets = new Map();
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 120;

let lastBucketCleanup = Date.now();

app.use((req, res, next) => {
  if (
    !selfHeal.controls.rateLimit ||
    req.path === "/api/health" ||
    req.path.startsWith("/public") ||
    (req.path.startsWith("/api/admin/self-heal/") &&
      req.path !== "/api/admin/self-heal/load-probe")
  ) {
    return next();
  }

  const now = Date.now();
  if (now - lastBucketCleanup >= 10_000) {
    for (const [ip, bucket] of requestBuckets) {
      if (now - bucket.start >= RATE_WINDOW_MS * 2) {
        requestBuckets.delete(ip);
      }
    }

    lastBucketCleanup = now;
  }

  const key = req.ip || req.socket.remoteAddress || "unknown";
  let bucket = requestBuckets.get(key);

  if (!bucket || now - bucket.start >= RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
  }

  bucket.count += 1;
  requestBuckets.set(key, bucket);

  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT));
  res.setHeader(
    "X-RateLimit-Remaining",
    String(Math.max(0, RATE_LIMIT - bucket.count)),
  );

  if (bucket.count > RATE_LIMIT) {
    selfHeal.counters.blocked += 1;

    logIncident(
      "rate-limit",
      "Request blocked because the rate limit was exceeded",
      true,
      { path: req.path },
    );

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((RATE_WINDOW_MS - (now - bucket.start)) / 1000),
    );

    res.setHeader("Retry-After", String(retryAfterSeconds));

    if (req.accepts("html")) {
      return res
        .status(429)
        .send(
          `Too many requests. Please wait ${retryAfterSeconds} seconds and try again.`,
        );
    }

    return res.status(429).json({
      error: "Too many requests",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((RATE_WINDOW_MS - (now - bucket.start)) / 1000),
      ),
    });
  }

  next();
});

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
      offlineActionId: {
        type: String,
        unique: true,
        sparse: true,
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

    if (!allowed.includes(req.body.status)) {
      return err(res, 400, "Invalid status", "Choose a valid status.");
    }

    const doctor = await Doctor.findById(req.session.doctorUser.id);

    if (!doctor || !doctor.active) {
      delete req.session.doctorUser;
      return res.redirect("/doctor/login");
    }

    // Reception appointment
    let appointment = await Appointment.findOne({
      _id: req.params.id,
      doctor: doctor._id,
    });

    let date;

    if (appointment) {
      date = appointment.date;
    } else {
      appointment = await OnlineAppointment.findOne({
        _id: req.params.id,
        doctor: doctor.name,
      });
      date = appointment?.appointmentDate;
    }

    if (!appointment) {
      return err(
        res,
        404,
        "Appointment not found",
        "This appointment does not belong to your doctor account.",
      );
    }

    appointment.status = req.body.status;
    await appointment.save();

    logIncident(
      "doctor-status-update",
      `Doctor updated appointment status to ${req.body.status}`,
      true,
      { appointmentId: String(appointment._id) },
    );

    res.redirect(
      "/doctor/panel?date=" +
        encodeURIComponent(date) +
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

app.get(
  "/appointments",
  auth,
  ar(async (req, res) => {
    const requestedDate = String(req.query.date || "");
    const date = validDate(requestedDate) ? requestedDate : today();

    const [receptionAppointments, onlineAppointments, patients, doctors] =
      await Promise.all([
        Appointment.find({ date }).populate("patient doctor").lean(),
        // Website se book ki gayi appointment
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
    // Dono collections ka data combined
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
  storageFullGuard,
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
      call: { from: ["Waiting", "Booked"], to: "In Consultation" },
      waiting: { from: ["In Consultation"], to: "Waiting" },
      complete: { from: ["In Consultation"], to: "Completed" },
      cancel: { from: ["Waiting", "Booked"], to: "Cancelled" },
    };

    const action = transitions[req.body.action];

    if (!action) {
      return err(res, 400, "Invalid action", "Queue action is invalid.");
    }

    let appointment = await Appointment.findById(req.params.id);
    let isOnline = false;
    let date;

    if (appointment) {
      date = appointment.date;
    } else {
      appointment = await OnlineAppointment.findById(req.params.id);
      isOnline = true;
      date = appointment?.appointmentDate;
    }

    if (!appointment) {
      return err(
        res,
        404,
        "Appointment not found",
        "Appointment does not exist.",
      );
    }

    if (!action.from.includes(appointment.status)) {
      return err(
        res,
        409,
        "Action not allowed",
        `Cannot apply action while status is ${appointment.status}.`,
      );
    }
    appointment.status = action.to;
    await appointment.save();

    logIncident(
      "queue-update",
      `${isOnline ? "Online" : "Reception"} appointment status changed to ${action.to}`,
      true,
      { appointmentId: String(appointment._id) },
    );

    res.redirect(
      "/queue?date=" + encodeURIComponent(date) + "&success=Queue+updated",
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
// ==================== SELF-HEALING DASHBOARD + API ====================
app.get("/admin/system-health", auth, (req, res) => {
  res.render("system-health", { title: "Self-Healing Control Center" });
});

// Database failure demo: disconnect application connection
app.post("/api/admin/self-heal/database-disconnect", auth, async (req, res) => {
  if (databaseDemo.disconnecting || databaseDemo.recovering) {
    return res
      .status(409)
      .json({ ok: false, error: "Another database operation is in progress." });
  }

  if (mongoose.connection.readyState !== 1) {
    return res
      .status(409)
      .json({ ok: false, error: "Database is already disconnected." });
  }

  databaseDemo.disconnecting = true;

  try {
    databaseDemo.failureStartedAt = new Date().toISOString();
    databaseDemo.recoveryStartedAt = null;
    databaseDemo.recoveredAt = null;
    databaseDemo.lastDowntimeMs = null;
    databaseDemo.lastRecoveryMs = null;

    await mongoose.disconnect();

    logIncident("database-failure", "Application disconnected from MongoDB.");

    res.json({
      ok: true,
      message: "Database disconnected. You can now test the failure.",
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    databaseDemo.disconnecting = false;
  }
});

// Database recovery demo: reconnect application to MongoDB
app.post("/api/admin/self-heal/database-recover", auth, async (req, res) => {
  if (databaseDemo.disconnecting || databaseDemo.recovering) {
    return res
      .status(409)
      .json({ ok: false, error: "Another database operation is in progress." });
  }

  if (mongoose.connection.readyState === 1) {
    return res.json({ ok: true, message: "Database is already connected." });
  }

  databaseDemo.recovering = true;
  databaseDemo.recoveryStartedAt = new Date().toISOString();
  const started = Date.now();

  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 10000 });

    const finished = Date.now();
    databaseDemo.recoveredAt = new Date(finished).toISOString();
    databaseDemo.lastRecoveryMs = finished - started;
    databaseDemo.lastDowntimeMs = databaseDemo.failureStartedAt
      ? finished - new Date(databaseDemo.failureStartedAt).getTime()
      : null;

    logIncident(
      "database-recovery",
      "MongoDB connection restored successfully.",
      true,
    );

    res.json({
      ok: true,
      message: "Database recovered successfully.",
    });
  } catch (err) {
    logIncident("database-recovery", "MongoDB recovery failed.");
    res.status(503).json({
      ok: false,
      error: "Recovery failed. Check that MongoDB is running, then try again.",
    });
  } finally {
    databaseDemo.recovering = false;
  }
});

// app.get("/api/health", (req, res) => {
//   const db = mongoose.connection.readyState === 1;
//   const status = db ? "healthy" : "degraded";
//   res.status(db ? 200 : 503).json({
//     app: "MediSync Clinic Management",
//     status,
//     database: db ? "connected" : "disconnected",
//     uptimeSeconds: Math.floor(process.uptime()),
//     memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
//     timestamp: new Date().toISOString(),
//   });
// });

app.get("/api/health", (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;

  res.status(200).json({
    app: "MediSync Clinic Management",
    application: "online",
    status: dbConnected ? "healthy" : "degraded",
    database: dbConnected ? "connected" : "disconnected",
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/admin/self-heal/load-probe", (req, res) => {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Admin login required",
    });
  }

  res.status(200).json({
    ok: true,
    message: "Request reached server",
    timestamp: new Date().toISOString(),
  });
});

// All management endpoints require an authenticated admin session.
app.get(
  "/api/admin/self-heal/status",
  auth,
  ar(async (req, res) => {
    let pm2 = { available: false, status: "Not detected", restarts: null };
    if (process.env.pm_id !== undefined || process.env.PM2_HOME) {
      pm2 = {
        available: true,
        status: "Managed by PM2",
        restarts: Number(process.env.pm2_restart_time || 0),
      };
    }
    res.json({
      controls: selfHeal.controls,
      counters: selfHeal.counters,
      crashRecovery: readCrashRecord(),
      incidents: selfHeal.incidents.slice(0, 30),
      quarantined: selfHeal.quarantined.slice(0, 30),
      database:
        mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      databaseDemo: {
        ...databaseDemo,
        currentDowntimeMs:
          databaseDemo.failureStartedAt && !databaseDemo.recoveredAt
            ? Date.now() - new Date(databaseDemo.failureStartedAt).getTime()
            : databaseDemo.lastDowntimeMs,
      },
      storageFailure: {
        ...mongoStorageDemo,
        simulatedUsedPercent: mongoStorageDemo.enabled ? 100 : 42,
        simulatedFreeSpaceGB: mongoStorageDemo.enabled ? 0 : 5.8,
      },
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      node: process.version,
      platform: os.platform(),
      pm2,
      now: new Date().toISOString(),
    });
  }),
);

// ==================== MONGODB STORAGE FULL CONTROLS ====================

// Turn the simulated storage failure ON
app.post("/api/admin/self-heal/mongodb-storage-full", auth, (req, res) => {
  if (!mongoStorageDemo.enabled) {
    mongoStorageDemo.enabled = true;
    mongoStorageDemo.failureStartedAt = new Date().toISOString();

    logIncident(
      "mongodb-storage-full",
      "Simulated MongoDB storage-full failure enabled",
      false,
    );
  }

  res.json({
    ok: true,
    enabled: true,
    failedAttempts: mongoStorageDemo.failedAttempts,
    message: "MongoDB storage-full simulation enabled.",
  });
});

// Turn the simulated storage failure OFF
app.post("/api/admin/self-heal/mongodb-storage-reset", auth, (req, res) => {
  const wasEnabled = mongoStorageDemo.enabled;

  mongoStorageDemo.enabled = false;
  mongoStorageDemo.failureStartedAt = null;

  if (wasEnabled) {
    logIncident(
      "mongodb-storage-full",
      "MongoDB storage-full simulation manually disabled",
      true,
    );
  }

  res.json({
    ok: true,
    enabled: false,
    failedAttempts: mongoStorageDemo.failedAttempts,
    message: "MongoDB storage simulation disabled.",
  });
});

// Get the storage failure status
app.get("/api/admin/self-heal/mongodb-storage-status", auth, (req, res) => {
  res.json({
    enabled: mongoStorageDemo.enabled,
    failedAttempts: mongoStorageDemo.failedAttempts,
    failureStartedAt: mongoStorageDemo.failureStartedAt,
    simulatedUsedPercent: mongoStorageDemo.enabled ? 100 : 42,
    simulatedFreeSpaceGB: mongoStorageDemo.enabled ? 0 : 5.8,
  });
});

app.post("/api/admin/self-heal/control", auth, (req, res) => {
  const allowed = ["watchdog", "offlineQueue", "rateLimit"];
  const { name, enabled } = req.body || {};
  if (!allowed.includes(name) || typeof enabled !== "boolean")
    return res.status(400).json({ error: "Invalid control" });
  selfHeal.controls[name] = enabled;
  logIncident("policy", `${name} ${enabled ? "enabled" : "disabled"}`, true, {
    control: name,
    enabled,
  });
  res.json({ ok: true, controls: selfHeal.controls });
});

app.post("/api/admin/self-heal/simulate", auth, (req, res) => {
  const kind = String(req.body?.kind || "");
  const simulations = {
    watchdog: () => {
      const status = Number(req.body?.probeStatus);
      const ms = Number(req.body?.probeMs);
      if (!Number.isFinite(status)) {
        return selfHeal.controls.watchdog
          ? logIncident(
              "watchdog",
              "Health-check demonstration requested; use the live probe result to verify the running service",
              true,
            )
          : logIncident(
              "watchdog",
              "Watchdog is OFF; health-check event recorded without recovery policy",
              false,
            );
      }
      return selfHeal.controls.watchdog && status >= 200 && status < 400
        ? logIncident(
            "watchdog",
            `Live health probe passed: HTTP ${status} in ${Number.isFinite(ms) ? ms : 0} ms; service remains healthy`,
            true,
            { status, ms },
          )
        : logIncident(
            "watchdog",
            `Live health probe returned HTTP ${status}; watchdog ${selfHeal.controls.watchdog ? "detected a degraded response" : "is OFF, so no recovery policy ran"}`,
            false,
            { status, ms },
          );
    },
    // offline: () =>
    //   selfHeal.controls.offlineQueue
    //     ? logIncident(
    //         "offline-queue",
    //         "Network interruption simulated; action retained in local queue for later sync",
    //         true,
    //       )
    //     : logIncident(
    //         "offline-queue",
    //         "Offline action could not be queued because offline-first mode is OFF",
    //         false,
    //       ),
    load: () => {
      const total = Math.min(130, Math.max(0, Number(req.body?.total) || 0));

      const passed = Math.min(
        total,
        Math.max(0, Number(req.body?.passed) || 0),
      );

      const limited = Math.min(
        total - passed,
        Math.max(0, Number(req.body?.limited) || 0),
      );

      const failed = Math.max(0, total - passed - limited);

      return logIncident(
        "rate-limit",
        `Real load test finished: ${passed} allowed, ${limited} throttled (429), ${failed} failed out of ${total} requests`,
        limited > 0,
        { total, passed, limited, failed },
      );
    },
  };
  if (!simulations[kind])
    return res.status(400).json({ error: "Unknown simulation" });
  const incident = simulations[kind]();
  res.json({ ok: true, incident, controls: selfHeal.controls });
});

// ========== OFFLINE APPOINTMENT SYNC ==========

app.post(
  "/api/admin/self-heal/offline-sync",
  auth,
  ar(async (req, res) => {
    if (!selfHeal.controls.offlineQueue) {
      return res.status(409).json({
        ok: false,
        error: "Offline queue is disabled.",
      });
    }

    // MongoDB storage-full simulation guard
    if (mongoStorageDemo.enabled) {
      mongoStorageDemo.failedAttempts++;

      logIncident(
        "mongodb-storage-full",
        "Offline appointment sync blocked because simulated MongoDB storage is full. Actions remain pending.",
        false,
        {
          path: req.originalUrl,
          failedAttempts: mongoStorageDemo.failedAttempts,
        },
      );

      return res.status(507).json({
        ok: false,
        code: "MONGODB_STORAGE_FULL",
        error:
          "MongoDB storage full. Offline appointments remain pending and can be retried after recovery.",
        retryable: true,
        simulated: true,
      });
    }
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        ok: false,
        error: "MongoDB unavailable. Keep actions pending.",
        retryable: true,
      });
    }

    const actions = Array.isArray(req.body?.actions)
      ? req.body.actions.slice(0, 25)
      : [];

    const results = [];

    for (const action of actions) {
      const actionId = String(action?.actionId || "");
      const payload = action?.payload || {};

      if (
        !/^[a-zA-Z0-9_-]{8,100}$/.test(actionId) ||
        action?.type !== "create-appointment"
      ) {
        results.push({
          actionId: actionId || null,
          status: "failed",
          retryable: false,
          message: "Invalid action ID or action type.",
        });
        continue;
      }

      try {
        // Idempotency check: this action may already have synced.
        const existingAppointment = await Appointment.findOne({
          offlineActionId: actionId,
        }).lean();

        if (existingAppointment) {
          results.push({
            actionId,
            status: "synced",
            alreadySynced: true,
            appointmentId: String(existingAppointment._id),
            tokenLabel: existingAppointment.tokenLabel,
          });
          continue;
        }

        const date = String(payload.date || "");
        const time = String(payload.time || "");
        const reason = String(payload.reason || "").trim();
        const mode = payload.patientMode;

        if (
          !validDate(date) ||
          date < today() ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
          !["new", "existing"].includes(mode) ||
          reason.length > 500
        ) {
          results.push({
            actionId,
            status: "failed",
            retryable: false,
            message: "Invalid date, time, patient mode, or reason.",
          });
          continue;
        }

        const doctorId = String(payload.doctorId || "");

        if (!mongoose.isValidObjectId(doctorId)) {
          results.push({
            actionId,
            status: "failed",
            retryable: false,
            message: "Invalid doctor selection.",
          });
          continue;
        }

        const doctor = await Doctor.findOne({
          _id: doctorId,
          active: true,
        }).lean();

        if (!doctor) {
          results.push({
            actionId,
            status: "failed",
            retryable: false,
            message: "Selected doctor is no longer active.",
          });
          continue;
        }

        // Re-check availability on the server.
        const [receptionConflict, onlineConflict] = await Promise.all([
          Appointment.exists({
            doctor: doctor._id,
            date,
            time,
            status: {
              $nin: ["Cancelled", "Completed"],
            },
          }),
          OnlineAppointment.exists({
            doctor: doctor.name,
            appointmentDate: date,
            appointmentTime: time,
            status: {
              $nin: ["Cancelled", "Completed"],
            },
          }),
        ]);

        if (receptionConflict || onlineConflict) {
          results.push({
            actionId,
            status: "failed",
            retryable: false,
            message: "This time slot is already booked. Choose another slot.",
          });
          continue;
        }

        let patient;

        if (mode === "existing") {
          const patientId = String(payload.patientId || "");

          if (!mongoose.isValidObjectId(patientId)) {
            results.push({
              actionId,
              status: "failed",
              retryable: false,
              message: "Select a valid existing patient.",
            });
            continue;
          }

          patient = await Patient.findById(patientId).lean();

          if (!patient) {
            results.push({
              actionId,
              status: "failed",
              retryable: false,
              message: "Existing patient was not found.",
            });
            continue;
          }
        } else {
          const p = payload.newPatient || {};
          const name = String(p.name || "").trim();
          const age = Number(p.age);
          const gender = String(p.gender || "");
          const phone = String(p.phone || "").trim();
          const email = String(p.email || "").trim();
          const address = String(p.address || "").trim();

          if (
            name.length < 2 ||
            name.length > 100 ||
            !Number.isInteger(age) ||
            age < 0 ||
            age > 120 ||
            !["Female", "Male", "Other"].includes(gender) ||
            !/^[0-9+() -]{7,20}$/.test(phone) ||
            email.length > 150 ||
            address.length > 300
          ) {
            results.push({
              actionId,
              status: "failed",
              retryable: false,
              message: "New patient details are invalid.",
            });
            continue;
          }

          // Do not trust patient IDs or fields supplied by the browser.
          patient = await Patient.create({
            name,
            age,
            gender,
            phone,
            email,
            address,
          });
        }

        const tokenNumber = await nextToken(date);
        const tokenLabel = `T-${String(tokenNumber).padStart(3, "0")}`;

        const appointment = await Appointment.create({
          patient: patient._id,
          doctor: doctor._id,
          date,
          time,
          reason,
          tokenNumber,
          tokenLabel,
          status: "Waiting",
          source: "reception",
          offlineActionId: actionId,
        });

        results.push({
          actionId,
          status: "synced",
          alreadySynced: false,
          appointmentId: String(appointment._id),
          tokenLabel: appointment.tokenLabel,
        });
      } catch (error) {
        console.error("Offline appointment sync failed:", error.message);

        // A unique-index collision may mean another request
        // already saved this exact action.
        if (error.code === 11000) {
          const duplicate = await Appointment.findOne({
            offlineActionId: actionId,
          }).lean();

          if (duplicate) {
            results.push({
              actionId,
              status: "synced",
              alreadySynced: true,
              appointmentId: String(duplicate._id),
              tokenLabel: duplicate.tokenLabel,
            });
            continue;
          }
        }

        results.push({
          actionId,
          status: "failed",
          retryable: true,
          message: "Temporary server error. Retry this action.",
        });
      }
    }

    const syncedCount = results.filter(
      (result) => result.status === "synced",
    ).length;

    selfHeal.counters.synced += syncedCount;

    if (syncedCount > 0) {
      logIncident(
        "offline-sync",
        `${syncedCount} offline appointment action(s) processed`,
        true,
        { syncedCount },
      );
    }

    res.json({
      ok: true,
      results,
      newlySynced: results.filter(
        (result) => result.status === "synced" && !result.alreadySynced,
      ).length,
      syncedTotal: selfHeal.counters.synced,
    });
  }),
);

// ========== OFFLINE BOOKING PAGE ==========

app.get("/admin/offline-booking", async (req, res) => {
  try {
    const patients = await Patient.find().sort({ name: 1 });
    const doctors = await Doctor.find({ active: true }).sort({ name: 1 });

    res.render("offline-booking", {
      title: "Offline Appointment Booking",
      patients,
      doctors,
    });
  } catch (error) {
    console.error("Offline booking page error:", error);
    res.status(500).send("Unable to load offline booking page.");
  }
});

app.post("/api/admin/self-heal/crash-test", auth, (req, res) => {
  if (
    process.env.ENABLE_CRASH_TEST !== "true" ||
    process.env.pm_id === undefined
  ) {
    return res.status(403).json({
      ok: false,
      error:
        "Crash test is available only when MediSync is running under PM2 with ENABLE_CRASH_TEST=true.",
    });
  }

  const incident = {
    id: `crash-${Date.now()}`,
    type: "watchdog",
    status: "failure_detected",
    message: "Test crash detected. PM2 restart expected.",
    detectedAt: new Date().toISOString(),
    recoveredAt: null,
  };

  try {
    saveCrashRecord(incident);
  } catch (err) {
    console.error("Could not save crash record:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Could not save crash record.",
    });
  }

  res.status(202).json({
    ok: true,
    message: "Failure detected. PM2 recovery is starting.",
    incident,
  });

  // Local demo: PM2 should restart the crashed process.
  setTimeout(() => {
    process.exit(1);
  }, 500);
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
/* ==================== START SERVER ==================== */

let mongoConnectInProgress = false;

async function connectMongoWithRetry() {
  if (mongoConnectInProgress || mongoose.connection.readyState === 1) {
    return;
  }

  mongoConnectInProgress = true;

  try {
    await mongoose.connect(URI, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log("MongoDB connected");

    const previousCrash = readCrashRecord();

    if (previousCrash && previousCrash.status === "failure_detected") {
      previousCrash.status = "recovered";
      previousCrash.message =
        "Application restarted and MongoDB connection was restored.";
      previousCrash.recoveredAt = new Date().toISOString();

      saveCrashRecord(previousCrash);

      logIncident(
        "watchdog-recovery",
        "PM2 restarted the application and MongoDB is connected.",
        true,
        { crashId: previousCrash.id },
      );

      console.log("SELF-HEAL: Crash recovery confirmed.");
    }
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);

    // Retry without terminating the application.
    setTimeout(connectMongoWithRetry, 5000);
  } finally {
    mongoConnectInProgress = false;
  }
}

// Monitor changes to the actual MongoDB connection.
mongoose.connection.on("connected", () => {
  console.log("MongoDB connection is ready.");
});

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected.");
});

mongoose.connection.on("error", (error) => {
  console.error("MongoDB error:", error.message);
});

app.listen(PORT, () => {
  console.log(`MediSync running at http://localhost:${PORT}`);
  connectMongoWithRetry();
});
