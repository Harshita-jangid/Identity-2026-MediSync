"use strict";

const $ = (selector) => document.querySelector(selector);

const menuBtn = $("#menuBtn");
const nav = $("#nav");
const form = $("#appointmentForm");
const message = $("#formMessage");
const dateInput = $("#appointmentDate");
const refreshBtn = $("#refreshAppointments");
const appointmentList = $("#appointmentList");

// Footer year
const yearElement = $("#year");

if (yearElement) {
  yearElement.textContent = new Date().getFullYear();
}

// Local date: YYYY-MM-DD
function getLocalToday() {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// Prevent past-date selection
if (dateInput) {
  dateInput.min = getLocalToday();
}

// Mobile navigation
menuBtn?.addEventListener("click", () => {
  const isOpen = nav?.classList.toggle("open") ?? false;
  menuBtn.setAttribute("aria-expanded", String(isOpen));
});

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    menuBtn?.setAttribute("aria-expanded", "false");
  });
});

// Display form messages
function showMessage(text, type = "") {
  if (!message) return;

  message.textContent = text;
  message.classList.remove("success", "error");

  if (type) {
    message.classList.add(type);
  }
}

// Book appointment
form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) return;

  const submitButton = form.querySelector('[type="submit"]');

  showMessage("Submitting your appointment request...");

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Booking...";
  }

  try {
    const data = new FormData(form);

    // Matches the updated HTML and server.js
    const payload = {
      patientName: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      doctor: String(data.get("doctor") || "").trim(),
      department: String(data.get("department") || "").trim(),
      appointmentDate: String(data.get("date") || ""),
      appointmentTime: String(data.get("time") || ""),
      reason: String(data.get("reason") || "").trim(),
    };

    // Validate required fields
    if (
      !payload.patientName ||
      !payload.email ||
      !payload.phone ||
      !payload.doctor ||
      !payload.department ||
      !payload.appointmentDate ||
      !payload.appointmentTime
    ) {
      throw new Error("Please complete all required fields.");
    }

    if (payload.appointmentDate < getLocalToday()) {
      throw new Error("Please choose today or a future date.");
    }

    // Send booking to Express server
    const response = await fetch("/api/appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.message || `Booking failed. Server error: ${response.status}`,
      );
    }

    // Reset form after successful save
    form.reset();

    if (dateInput) {
      dateInput.min = getLocalToday();
    }

    const appointment = result.appointment || {};
    const reference = appointment._id || "Confirmed";
    const token = appointment.tokenLabel
      ? ` OPD Token: ${appointment.tokenLabel}.`
      : "";

    showMessage(
      `Appointment booked successfully! Reference ID: ${reference}.${token} Please contact the clinic if you need to change your booking.`,
      "success",
    );
  } catch (error) {
    console.error("Appointment booking error:", error);

    showMessage(
      error.message ||
        "Could not connect to the server. Please check the server and MongoDB.",
      "error",
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = "Request appointment <span>→</span>";
    }
  }
});

// Keep appointment records private on the public website
if (appointmentList) {
  appointmentList.innerHTML = `
    <div class="empty-state">
      <span>♡</span>
      <h3>Your privacy matters</h3>
      <p>
        Appointment details are managed by the clinic
        and are not displayed in this public section.
      </p>
      <a href="#book" class="button primary">
        Book an appointment ↗
      </a>
    </div>
  `;
}

// Booking enquiry
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    showMessage(
      "Please contact the clinic with your appointment reference ID to check your booking.",
    );
  });
}

async function loadDoctors() {
  const doctorSelect = document.getElementById("doctorSelect");
  const doctorGrid = document.getElementById("doctorGrid");

  try {
    const response = await fetch("/api/doctors");

    if (!response.ok) {
      throw new Error("Unable to fetch doctors");
    }

    const doctors = await response.json();

    // Appointment form dropdown
    if (doctorSelect) {
      doctorSelect.innerHTML = '<option value="">Select doctor</option>';

      doctors.forEach((doctor) => {
        const option = document.createElement("option");
        option.value = doctor.name;
        option.textContent = doctor.name;
        doctorSelect.appendChild(option);
      });

      if (doctors.length === 0) {
        doctorSelect.innerHTML =
          '<option value="">No doctors available</option>';
      }
    }

    // Our Doctors section
    if (doctorGrid) {
      doctorGrid.replaceChildren();

      if (doctors.length === 0) {
        doctorGrid.textContent = "No doctors available currently.";
        return;
      }

      doctors.forEach((doctor, index) => {
        const card = document.createElement("article");
        card.className = "doctor-card";

        const info = document.createElement("div");
        info.className = "doctor-info";

        const badge = document.createElement("span");
        badge.className = "doctor-badge";
        badge.textContent = doctor.specialization || "CLINIC DOCTOR";

        const name = document.createElement("h3");
        name.textContent = doctor.name;

        const specialization = document.createElement("p");
        specialization.textContent =
          doctor.specialization || "Healthcare Professional";

        const link = document.createElement("a");
        link.href = "#book";
        link.textContent = "Book consultation";

        link.addEventListener("click", () => {
          if (doctorSelect) {
            doctorSelect.value = doctor.name;
          }
        });

        info.append(badge, name, specialization, link);
        card.append(info);
        doctorGrid.appendChild(card);
      });
    }
  } catch (error) {
    console.error("Doctors loading error:", error);

    if (doctorSelect) {
      doctorSelect.innerHTML =
        '<option value="">Unable to load doctors</option>';
    }

    if (doctorGrid) {
      doctorGrid.textContent =
        "Doctors could not be loaded. Please refresh the page.";
    }
  }
}

loadDoctors();
