/* =====================================================
   CONFIGURATION
   Point this at the SAME backend/database the admin-site
   and student-site apps use.
===================================================== */

const API_URL = "http://localhost:5000/api";

let currentUser = null;
let accessToken = null;
let currentSessionId = null;
let currentSessionExpiry = null;
let rotateInterval = null;
let qrObj = null;

const onLoginPage = !!document.getElementById("loginForm");
const onDashboardPage = !!document.getElementById("appPage");


/* =====================================================
   INIT
===================================================== */

document.addEventListener("DOMContentLoaded", () => {
    accessToken = localStorage.getItem("teacherAccessToken");
    const storedUser = localStorage.getItem("teacherCurrentUser");

    if (onDashboardPage) {
        if (accessToken && storedUser) {
            currentUser = JSON.parse(storedUser);
            if (currentUser.role !== "teacher") { logout(); return; }
            showDashboard();
        } else {
            window.location.href = "login.html";
        }
    } else if (onLoginPage && accessToken && storedUser) {
        window.location.href = "dashboard.html";
    }
});


/* =====================================================
   API HELPER
===================================================== */

async function apiRequest(endpoint, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    const response = await fetch(API_URL + endpoint, { ...options, headers });
    const contentType = response.headers.get("content-type");
    const data = contentType && contentType.includes("application/json")
        ? await response.json()
        : { message: await response.text() };

    if (!response.ok) throw new Error(data.error || data.message || "Request failed");
    return data;
}


/* =====================================================
   LOGIN / REGISTER TOGGLE
===================================================== */

function showRegisterSection() {
    document.getElementById("loginSection").classList.add("hidden");
    document.getElementById("registerSection").classList.remove("hidden");
}
function showLoginSection() {
    document.getElementById("registerSection").classList.add("hidden");
    document.getElementById("loginSection").classList.remove("hidden");
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;
        const message = document.getElementById("loginMessage");

        message.textContent = "Logging in...";
        message.className = "message";

        try {
            const data = await apiRequest("/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password })
            });

            if (data.user.role !== "teacher") {
                message.textContent = "This account is not a teacher account.";
                message.className = "message error";
                return;
            }

            localStorage.setItem("teacherAccessToken", data.access_token);
            localStorage.setItem("teacherCurrentUser", JSON.stringify(data.user));
            message.textContent = "Login successful";
            message.className = "message success";
            setTimeout(() => window.location.href = "dashboard.html", 300);

        } catch (error) {
            message.textContent = error.message;
            message.className = "message error";
        }
    });
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const message = document.getElementById("registerMessage");
        const body = {
            name: document.getElementById("registerName").value.trim(),
            email: document.getElementById("registerEmail").value.trim(),
            password: document.getElementById("registerPassword").value,
            role: "teacher",
            employee_id: document.getElementById("employeeId").value.trim()
        };

        message.textContent = "Creating account...";
        message.className = "message";

        try {
            await apiRequest("/auth/register", { method: "POST", body: JSON.stringify(body) });
            message.textContent = "Registration successful. You can now login.";
            message.className = "message success";
            registerForm.reset();
            setTimeout(showLoginSection, 800);
        } catch (error) {
            message.textContent = error.message;
            message.className = "message error";
        }
    });
}


/* =====================================================
   DASHBOARD
===================================================== */

function showDashboard() {
    document.getElementById("sidebarUserName").textContent = currentUser.name;
    document.getElementById("sidebarUserRole").textContent = currentUser.role;
    document.getElementById("topUserName").textContent = currentUser.name;
    loadDashboard();
}

async function loadDashboard() {
    setActiveNav(0);
    document.getElementById("pageTitle").textContent = "Dashboard";
    try {
        const sessions = await apiRequest("/teacher/sessions");
        document.getElementById("sessionCount").textContent = sessions.length;
        renderSessions(sessions);
    } catch (error) {
        console.error(error);
    }
}

async function loadSessions() {
    setActiveNav(1);
    document.getElementById("pageTitle").textContent = "Daily Sessions";
    try {
        renderSessions(await apiRequest("/teacher/sessions"));
    } catch (error) {
        console.error(error);
    }
}

function setActiveNav(index) {
    document.querySelectorAll(".nav-btn").forEach((btn, i) => btn.classList.toggle("active", i === index));
}


/* =====================================================
   GENERATE QR + START ROTATION
===================================================== */

const attendanceForm = document.getElementById("attendanceForm");
if (attendanceForm) {
    attendanceForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const expiry = document.getElementById("expiryMinutes").value;
        const message = document.getElementById("teacherMessage");

        try {
            const data = await apiRequest("/attendance/sessions", {
                method: "POST",
                body: JSON.stringify({ type: "daily", expiry_minutes: Number(expiry) })
            });

            currentSessionId = data.session.id;
            currentSessionExpiry = new Date(data.session.expires_at);

            document.getElementById("qrCard").classList.remove("hidden");
            const qr = document.getElementById("qrcode");
            qr.innerHTML = "";
            qrObj = new QRCode(qr, {
                text: data.qr_data, width: 220, height: 220,
                colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H
            });

            startRotation(data.qr_data);

            message.textContent = "Daily attendance session started.";
            message.className = "message success";
            await loadSessions();
            document.getElementById("sessionCount").textContent =
                (await apiRequest("/teacher/sessions")).length;

        } catch (error) {
            message.textContent = error.message;
            message.className = "message error";
        }
    });
}

/* Refreshes the on-screen QR every second so a screenshotted
   code stops scanning a second later. This calls a rotation
   endpoint on the SAME session (assumed route below) to get a
   fresh, backend-validated token each tick. If your API doesn't
   expose that route yet, add one — a client-only rotation would
   just be cosmetic, since the backend wouldn't recognize the
   new codes as valid scans. */
function startRotation(initialQrData) {
    clearInterval(rotateInterval);
    let lastGoodQrData = initialQrData;

    rotateInterval = setInterval(async () => {
        const diff = currentSessionExpiry - new Date();
        if (diff <= 0) {
            clearInterval(rotateInterval);
            document.getElementById("qrTimer").textContent = "EXPIRED";
            document.getElementById("qrTimer").style.color = "#dc2626";
            return;
        }

        const totalSeconds = Math.floor(diff / 1000);
        document.getElementById("qrTimer").textContent =
            `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;

        try {
            const refreshed = await apiRequest(`/attendance/sessions/${currentSessionId}/rotate-token`, { method: "POST" });
            lastGoodQrData = refreshed.qr_data;
        } catch (error) {
            // Backend has no rotation route yet — keep the last known-good code
            // instead of drawing a code the backend won't accept.
        }

        qrObj.clear();
        qrObj.makeCode(lastGoodQrData);
    }, 1000);
}


/* =====================================================
   CLOSE SESSION
===================================================== */

async function closeAttendanceSession() {
    if (!currentSessionId) return;
    try {
        await apiRequest(`/attendance/sessions/${currentSessionId}/close`, { method: "POST" });
        clearInterval(rotateInterval);
        document.getElementById("qrTimer").textContent = "CLOSED";
        document.getElementById("teacherMessage").textContent = "Attendance session closed.";
        document.getElementById("teacherMessage").className = "message success";
        currentSessionId = null;
        await loadSessions();
    } catch (error) {
        alert(error.message);
    }
}


/* =====================================================
   SESSIONS TABLE
===================================================== */

function renderSessions(sessions) {
    const container = document.getElementById("sessionsTable");
    if (!sessions.length) {
        container.innerHTML = "<p class='muted'>No attendance sessions yet.</p>";
        return;
    }
    container.innerHTML = `
        <table>
            <thead><tr><th>ID</th><th>Started</th><th>Expires</th><th>Status</th><th>Records</th></tr></thead>
            <tbody>
                ${sessions.map(s => `
                    <tr>
                        <td>${s.id}</td>
                        <td>${formatDate(s.started_at)}</td>
                        <td>${formatDate(s.expires_at)}</td>
                        <td>${s.active ? "🟢 Active" : "🔴 Closed"}</td>
                        <td><button class="small-btn" onclick="viewSessionAttendance(${s.id})">View</button></td>
                    </tr>`).join("")}
            </tbody>
        </table>`;
}

async function viewSessionAttendance(sessionId) {
    try {
        const data = await apiRequest(`/attendance/sessions/${sessionId}`);
        let text = `Daily Attendance Session\n\nPresent: ${data.total_present}\n\n`;
        data.attendance.forEach(r => text += `${r.roll_number} - ${r.student_name}\n`);
        alert(text);
    } catch (error) {
        alert(error.message);
    }
}


/* =====================================================
   LOGOUT / UTILITIES
===================================================== */

function logout() {
    clearInterval(rotateInterval);
    localStorage.removeItem("teacherAccessToken");
    localStorage.removeItem("teacherCurrentUser");
    window.location.href = "login.html";
}

function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
}
