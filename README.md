Copy the complete text below and paste it into your GitHub **`README.md`** file. This is the updated version of your MediSync README, including the website, clinic management software, online appointment workflow, self-healing features, and PM2 commands.

---

# 🏥 MediSync — Self-Healing Clinic Management System

### Smart Clinic Management with Automated Failure Detection and Recovery

<p align="center">
  <strong>A Resilient, Self-Healing Clinic Management Application</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Project-Clinic%20Management-0F766E?style=for-the-badge" alt="Clinic Management">
  <img src="https://img.shields.io/badge/Architecture-Self--Healing-16A34A?style=for-the-badge" alt="Self-Healing">
  <img src="https://img.shields.io/badge/Backend-Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Database-MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB">
</p>

---

## 📌 Project Overview

**MediSync** is a Self-Healing Clinic Management System developed to simplify clinic operations while improving application resilience, reliability, and fault tolerance.

Traditional clinic management applications may experience service interruptions when a database becomes unavailable, incoming requests exceed system capacity, or an application process crashes. Such failures can interrupt appointment booking and other essential clinic operations.

MediSync addresses these challenges by combining clinic management functionality with a dedicated **Self-Healing Control Center** that demonstrates failure detection, monitoring, recovery, and resilience mechanisms.

The system integrates application monitoring, database failure and recovery, offline appointment booking, rate limiting, and load shedding into a single application.

Its primary objective is to demonstrate how a software application can respond to selected failures, recover from supported failure scenarios, and maintain a more reliable user experience with minimal manual intervention.

## 🎯 Project Objectives

- Develop a practical clinic management application.
- Demonstrate self-healing concepts through controlled failure simulations.
- Detect and recover from supported application and database failures.
- Reduce service disruption during excessive incoming traffic.
- Support appointment booking when the application is temporarily offline.
- Monitor system health and display failure-related information through a centralized dashboard.
- Understand fault tolerance, resilience, recovery strategies, and application monitoring.

---

## ✨ Key Features

### 🏥 1. Clinic Management

MediSync provides a centralized application for managing essential clinic operations.

- Patient record management.
- Doctor information and specialization management.
- Appointment scheduling and management.
- OPD queue and token management.
- Online appointment booking through the public website on port `3000`.
- Website-to-software appointment flow: submitted online requests appear in the clinic software on port `5000` after successful backend/database processing.
- Doctor panel for viewing and managing assigned appointments.
- Administrative dashboard.
- Reports and operational insights.

### 🌐 2. Public Website for Patients — Book from Home

MediSync includes a public-facing website that patients can use from home or any other location with internet access, without needing to visit the clinic reception just to submit an appointment request. The reception team uses the separate clinic management software at the clinic.

**Website:** `http://localhost:3000`  
**Clinic Management Software:** `http://localhost:5000`

Website capabilities include:

- Browse the clinic website and its available information.
- Submit an online appointment request.
- Send a query through the website's contact/query form.

#### Website-to-Reception Workflow

1. A patient opens the MediSync website from home or another location using port `3000`.
2. The patient fills in and submits the online appointment form.
3. The website sends the appointment information to the configured backend workflow.
4. The appointment request is saved to the application's database.
5. Reception staff open the MediSync clinic software at the clinic on port `5000`.
6. The online appointment request appears in the software's online appointments section, where reception staff can review and manage it.

This workflow lets patients request appointments remotely while the reception team handles those requests from the clinic's management software.

> **Important:** The website and software must be configured to use the correct backend/API and database connection for online appointments to appear in the management software.

### 🛡️ 3. Self-Healing Control Center

The Self-Healing Control Center is the core component that distinguishes MediSync from a conventional clinic management application.

It provides a centralized interface for monitoring the application and demonstrating supported failure-handling mechanisms.

Key capabilities include:

- Application health monitoring.
- Database status monitoring.
- Controlled failure simulations.
- Database failure and recovery demonstration.
- Offline appointment synchronization.
- Rate limiting and load shedding.
- Watchdog-based process monitoring with PM2.
- Incident monitoring and recovery status visibility.

### 🔄 4. Watchdog and Process Recovery

MediSync uses PM2 to support application process supervision.

The watchdog and process management mechanism helps monitor application availability and allows PM2 to restart the application process when it exits unexpectedly.

**Purpose:** Improve application availability and reduce the need for manual process restarts after supported crash scenarios.

> Note: PM2 process supervision and application-level self-healing controls are related but separate mechanisms. Their behavior depends on the process configuration and whether the relevant controls are enabled.

### 📡 5. Offline Appointment Booking

The offline appointment feature helps preserve appointment information when the application cannot be reached.

It uses browser-side IndexedDB to store pending appointment actions locally.

Key capabilities include:

- Store appointment requests locally.
- Maintain pending offline appointments in the browser.
- Display appointments awaiting synchronization.
- Synchronize pending actions when connectivity returns.
- Provide visibility into pending or unsuccessful synchronization attempts.

**Purpose:** Reduce the risk of losing an appointment request during temporary connectivity or server interruptions.

> Note: Locally stored appointments are not automatically equivalent to confirmed server-side appointments. Successful synchronization and server-side validation are required.

### 🚦 6. Rate Limiting and Load Shedding

MediSync implements rate limiting and load shedding to demonstrate how an application can respond to excessive incoming traffic.

Rate limiting restricts requests that exceed the configured threshold, while load shedding helps reject or limit additional work when the system is under pressure.

Key benefits include:

- Restrict excessive incoming requests.
- Return appropriate responses when request limits are exceeded.
- Reduce unnecessary processing during traffic spikes.
- Demonstrate controlled handling of simulated high-load scenarios.

**Purpose:** Improve service stability and protect application resources during excessive request activity.

### 🗄️ 7. Database Failure and Recovery

MediSync includes a controlled database failure simulation to demonstrate how the application behaves when database connectivity is interrupted.

The recovery workflow allows the database connection to be restored and the application to resume normal database-dependent operations when the database is available again.

The control center can be used to demonstrate the failure, observe the interruption, initiate recovery, and review the resulting status.

**Purpose:** Understand database availability, failure handling, recovery workflows, and the importance of reliable data access.

### 💾 8. Storage Failure Simulation

MediSync also includes a storage failure simulation that demonstrates how the application responds when a storage-related failure condition is triggered.

This mechanism is intended to make failure behavior visible during testing and demonstrate the importance of error handling.

**Current implementation status:** Storage failure simulation is implemented, but automatic recovery for this particular failure has not yet been implemented.

This limitation is explicitly acknowledged as an opportunity for future improvement.

### 📊 9. Monitoring and Incident Visibility

The Self-Healing Control Center brings important operational information together in one interface.

Depending on the mechanism and current application state, the dashboard can be used to observe:

- Application health.
- Database availability.
- Failure simulation results.
- Recovery status.
- Incident information.
- Relevant timing and status indicators.

This helps demonstrate the difference between a system that merely encounters a failure and one that has mechanisms to detect and handle it.

---

## 🧠 Self-Healing Mechanisms at a Glance

| Mechanism | Purpose | Implementation Status |
|---|---|---|
| Watchdog and PM2 | Monitor and restart an exited application process | Implemented |
| Offline appointment handling | Store pending appointment actions locally and synchronize them | Implemented |
| Rate limiting | Restrict excessive incoming requests | Implemented |
| Load shedding | Limit additional work during simulated high traffic | Implemented |
| Database failure simulation | Demonstrate database unavailability | Implemented |
| Database recovery | Restore operation after database connectivity is recovered | Implemented |
| Storage failure simulation | Demonstrate a storage-related failure | Implemented |
| Storage failure recovery | Automatically recover from the simulated storage failure | Not yet implemented |

**Important distinction:** Process supervision, database recovery, offline synchronization, and request protection address different failure scenarios. They should not be treated as a single universal recovery mechanism.

---

## 🛠️ Technology Stack

The following technologies are used in the project.

### Public Website and Clinic Software Frontends

- Separate public website (port `3000`) and clinic management software (port `5000`)
- HTML5
- CSS3
- JavaScript
- EJS (Embedded JavaScript Templates)
- IndexedDB for browser-side offline storage

### Backend

- Node.js
- Express.js
- REST-style API endpoints

### Database

- MongoDB
- Mongoose

### Reliability and Process Management

- PM2 for application process supervision
- Rate limiting and load shedding
- Database failure and recovery workflows
- Offline appointment synchronization
- Health monitoring and controlled failure simulations

### Development Tools

- Visual Studio Code
- Git
- GitHub
- npm
- MongoDB

---

## 🏗️ System Architecture

MediSync consists of two connected interfaces: a public website for patients and a clinic management application for clinic staff.

```text
  PATIENT (AT HOME / REMOTE)
             |
             v
  +---------------------------+
  | MediSync Public Website   |
  | http://localhost:3000     |
  | Online Appointment Form   |
  | Contact / Query Form      |
  +-------------+-------------+
                |
                | Appointment/API request
                v
  +---------------------------+
  | Configured Backend/API    |
  | Validation and Processing |
  +-------------+-------------+
                |
                v
  +---------------------------+
  | MongoDB Database          |
  | Online Appointment Data   |
  +-------------+-------------+
                |
                | Read / manage saved appointments
                v
  +---------------------------+
  | MediSync Clinic Software  |
  | http://localhost:5000     |
  | Admin and Doctor Panels   |
  | Online Appointments       |
  | Self-Healing Control Center|
  +---------------------------+
        ^
        |
  RECEPTION STAFF AT CLINIC

  Supporting reliability components:
  - PM2 process supervision
  - Browser IndexedDB for offline appointment actions
  - Rate limiting and load shedding
  - Database failure and recovery workflows
```

### Website-to-Reception Flow

1. A patient submits an appointment request from home through the website on port `3000`.
2. The configured backend validates and saves the request to MongoDB.
3. Reception staff at the clinic open the management software on port `5000`.
4. The saved online appointment request appears in the software for reception staff to review and manage.
5. The self-healing mechanisms monitor and handle their supported failure scenarios.

The exact API route and database collection depend on the implementation in the repository. The website and software must use compatible API endpoints and the appropriate shared database records.

### How It Works

- Patients use the public website to submit online appointment requests and queries.
- Clinic staff use the management software to manage patients, doctors, appointments, queues, and reports.
- The Self-Healing Control Center provides monitoring and controlled failure demonstrations.
- Offline appointment actions can be synchronized when connectivity returns.
- PM2 supervises each configured Node.js process independently.

---

## ⚙️ Installation and Setup

MediSync runs two Node.js applications locally:

| Application | Port | Local URL | Who uses it / Purpose |
|---|---:|---|---|
| Public Website | `3000` | `http://localhost:3000` | Patients use it from home or elsewhere to submit online appointment requests and queries |
| Clinic Reception / Management Software | `5000` | `http://localhost:5000` | Reception staff use it at the clinic to manage patients, doctors, appointments, queues, and the Self-Healing Control Center |

> **Before starting:** The commands below assume the website and clinic software are in separate folders and each has its own `package.json`. Replace the example folder paths and entry filenames with the actual ones in your repository.

### Prerequisites

Install the following:

- Node.js and npm
- MongoDB Community Server or access to a MongoDB deployment
- Git
- PM2
- Visual Studio Code or another code editor

### Step 1: Clone the Repository

```bash
git clone https://github.com/Harshita-jangid/Identity-2026-MediSync/
cd identity
```

If the website and software are stored in separate repositories, clone each repository and follow the installation steps in each folder.

### Step 2: Install Dependencies

Open a terminal in the **website folder** and run:

```bash
npm install
```

Open another terminal in the **clinic management software folder** and run:

```bash
npm install
```

Run these commands in the folders that contain the respective `package.json` files.

### Step 3: Configure the Database and API

Configure the environment variables expected by each application. For example, the clinic software may use:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/medisync_clinic_management
```

The public website may use:

```env
PORT=3000
```

If the website sends appointment requests to a backend API, configure its API/base URL to point to the correct backend endpoint. Use the actual variable names and API route from your code; the names above are examples, not a replacement for existing configuration.

**Security:** Never commit real database passwords, private connection strings, API keys, or other secrets. Add `.env` files to `.gitignore` and provide a safe `.env.example` without credentials if needed.

### Step 4: Start MongoDB

Make sure MongoDB is running and accessible to the application using the configured connection string. If both applications use the same appointment database workflow, ensure the website's appointment submission and the clinic software's appointment listing use compatible database configuration and collection/model definitions.

### Step 5: Run Both Applications Without PM2

Start the **clinic management software** from its folder:

```bash
node server.js
```

Start the **public website** from its folder in a second terminal:

```bash
node server.js
```

These examples assume each application uses `server.js` as its entry point. If the website uses another file, such as `app.js`, use that filename instead. If the `package.json` provides a working start script, `npm start` can be used instead.

Open:

- Website: `http://localhost:3000`
- Clinic management software: `http://localhost:5000`

Confirm that the website's online appointment form submits successfully and that the saved appointment appears in the clinic software.

### Step 6: Install PM2

Install PM2 globally so it can manage both Node.js processes:

```bash
npm install -g pm2
```

Verify the installation:

```bash
pm2 --version
```

### Step 7: Start the Clinic Software with PM2

Open a terminal in the **clinic management software folder** and run:

```bash
pm2 start server.js --name medisync-software
```

This starts the software process under the PM2 name `medisync-software`.

### Step 8: Start the Website with PM2

Open a terminal in the **public website folder** and run:

```bash
pm2 start server.js --name medisync-website
```

If the website entry file is not `server.js`, replace it with the correct filename, for example:

```bash
pm2 start app.js --name medisync-website
```

PM2 starts and supervises each application as a separate process. The application code must listen on the intended port (`5000` for the software and `3000` for the website). If the port is configured through environment variables, ensure the application reads `process.env.PORT`.

### Step 9: Check PM2 Status and Logs

View both processes:

```bash
pm2 status
```

View logs for both applications:

```bash
pm2 logs
```

View logs for only the clinic software:

```bash
pm2 logs medisync-software
```

View logs for only the website:

```bash
pm2 logs medisync-website
```

Restart an application after making changes:

```bash
pm2 restart medisync-software
pm2 restart medisync-website
```

Stop an application:

```bash
pm2 stop medisync-software
pm2 stop medisync-website
```

Save the current PM2 process list:

```bash
pm2 save
```

> **PM2 note:** `pm2 save` saves the current process list. Starting those processes automatically after a full machine reboot requires configuring PM2 startup for the operating system. The exact startup setup differs between Windows and Linux/macOS.

### Step 10: Verify the Complete Workflow

1. Confirm `pm2 status` shows both applications as `online`.
2. Open `http://localhost:3000`.
3. Submit a test online appointment.
4. Open `http://localhost:5000`.
5. Verify the appointment appears in the clinic management software.
6. Open the Self-Healing Control Center and test only the supported failure simulations.

---

## 🧪 Demonstrating the Self-Healing System

MediSync is designed to demonstrate resilience through controlled failure scenarios.

For a project demonstration, use the Self-Healing Control Center to show the following workflows.

### Demonstration 1: Application Process Failure

1. Start MediSync with the configured PM2 process.
2. Confirm that the application is accessible.
3. Trigger the supported process-crash test.
4. Observe the process supervision and restart behavior.
5. Verify that the application becomes accessible again.

**Expected outcome:** PM2 can restart an application process that exits unexpectedly, provided the process is configured correctly.

### Demonstration 2: Offline Appointment Booking

1. Open the offline appointment booking page.
2. Simulate the supported offline or unavailable-server condition.
3. Create an appointment action.
4. Verify that the action is stored locally in IndexedDB.
5. Restore connectivity.
6. Synchronize the pending appointment.
7. Verify its status on the server.

**Expected outcome:** The pending action can be synchronized after connectivity returns, subject to successful validation and server processing.

### Demonstration 3: Rate Limiting and Load Shedding

1. Open the Self-Healing Control Center.
2. Run the configured load test or request simulation.
3. Observe the application's response to excessive traffic.
4. Verify that requests exceeding the configured rate limit are rejected appropriately.
5. Review the resulting status or incident information.

**Expected outcome:** Excessive requests are limited according to the configured policy, helping protect application resources.

### Demonstration 4: Database Failure and Recovery

1. Confirm that the application and database are operating normally.
2. Trigger the database failure simulation.
3. Observe the database status and the effect on database-dependent operations.
4. Initiate the supported recovery workflow.
5. Verify that database connectivity has been restored.
6. Confirm that database-dependent operations work again.

**Expected outcome:** The application can recover from the demonstrated database connectivity failure when the database becomes available and the recovery workflow succeeds.

### Demonstration 5: Storage Failure

1. Open the Self-Healing Control Center.
2. Trigger the implemented storage failure simulation.
3. Observe the failure response.
4. Review the application behavior and relevant error information.

**Expected outcome:** The application demonstrates the configured storage failure condition.

**Current limitation:** Automatic recovery for this storage failure has not yet been implemented.

---

## 🔐 Reliability, Limitations, and Future Scope

MediSync demonstrates several practical reliability techniques, but not every failure can be recovered from automatically.

### Current Limitations

- Storage failure recovery is not yet implemented.
- Offline appointment synchronization depends on restored connectivity and successful server-side processing.
- PM2 process recovery does not automatically resolve every application-level or database-level failure.
- Recovery behavior depends on the configuration of each individual mechanism.
- The project is an academic demonstration and has not been presented as a production-certified healthcare system.

### Future Enhancements

Potential improvements include:

- Automatic recovery workflows for storage-related failures.
- Persistent incident history and structured application logs.
- More detailed recovery-time metrics and performance monitoring.
- Health checks and alerting for additional application dependencies.
- Automated testing for individual failure and recovery scenarios.
- Improved synchronization conflict handling for offline appointments.
- Role-based access control and stronger security validation.
- Backup, restore, and data-integrity verification workflows.
- Containerization and automated deployment pipelines.
- Additional resilience tests under realistic traffic conditions.

---

## 🎓 Academic Project Information

**Project Title:** MediSync — Self-Healing Clinic Management System

**Developed By:** Harshita Jangid

**Course:** Bachelor of Computer Applications (BCA), Third Year

**Institution:** Dezyne École College

**Project Domain:** Web Development, Remote Online Appointment Booking, Clinic Reception Management, Software Reliability, and Self-Healing Systems

**Project Type:** Academic Project

### Learning Outcomes

Through this project, I explored:

- Full-stack web application development.
- Backend development using Node.js and Express.js.
- Database integration using MongoDB and Mongoose.
- Application process supervision using PM2.
- Offline-first browser storage using IndexedDB.
- Rate limiting and load-shedding techniques.
- Database failure handling and recovery.
- Controlled fault injection and resilience testing.
- Monitoring, error handling, and system reliability.

---

## 👩‍💻 About the Developer

Hi! I'm **Harshita Jangid**, a third-year Bachelor of Computer Applications (BCA) student at **Dezyne École College**.

I am interested in software development, problem-solving, and building practical applications that address real-world challenges.

MediSync has helped me explore how a patient-facing website can support appointment requests from home while clinic reception staff manage those requests through a separate clinic management application. It has also helped me understand the importance of designing software that can handle failures gracefully.

Through this project, I have worked with web technologies, database integration, offline data handling, process supervision, and self-healing concepts.

I look forward to continuing to learn, improve my technical skills, and build more reliable and user-friendly software applications.

---

## ⭐ Support

If you find this project interesting, consider giving the repository a **star ⭐** on GitHub.

Feedback, suggestions, and constructive contributions are welcome.

---

<p align="center">
  <strong>Built with curiosity, continuous learning, and a focus on software resilience.</strong>
  <br>
  MediSync — Making Clinic Management More Resilient.
</p>
