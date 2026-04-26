console.log("SafeGate: Core logic version 2.1 detected.");
class SafeGate {
    constructor() {
        this.currentRole = null;

        this.students = [];
        this.attendanceLogs = [];
        this.users = [];
        this.schools = [];
        this.notifications = [];
        this.notificationReceipts = [];
        this.classes = [];

        // Global Feature Flags
        this.featureFlags = JSON.parse(localStorage.getItem('safegate_flags')) || {
            allowGatekeeperScanning: true,
            allowParentNotifications: true,
            allowStudentProfiles: true,
            allowParentPortal: true
        };

        // Initialize UI
        this.applyTheme();
        this.init();
    }

    async loadFirebaseData() {
        if (!window.db) {
            this.showToast("Firebase not initialized! Check config.", "error");
            return;
        }
        
        try {
            // Listen to users
            window.db.collection('users').onSnapshot(snap => {
                this.users = snap.docs.map(doc => ({id: doc.id, ...doc.data()}));
                if (document.getElementById('gatekeepers-view') && document.getElementById('gatekeepers-view').classList.contains('active')) {
                    this.renderGatekeepers();
                }
                if (document.getElementById('admins-view') && document.getElementById('admins-view').classList.contains('active')) {
                    this.renderAdmins();
                }
                if (document.getElementById('schools-view') && document.getElementById('schools-view').classList.contains('active')) {
                    this.renderSchools();
                }
            });
            // Listen to schools
            window.db.collection('schools').onSnapshot(snap => {
                this.schools = snap.docs.map(doc => ({firebase_id: doc.id, ...doc.data()}));
                this.applyTheme();
                if (document.getElementById('admins-view') && document.getElementById('admins-view').classList.contains('active')) {
                    this.renderAdmins();
                }
                if (document.getElementById('schools-view') && document.getElementById('schools-view').classList.contains('active')) {
                    this.renderSchools();
                }
            });
            // Listen to students
            window.db.collection('students').onSnapshot(snap => {
                this.students = snap.docs.map(doc => {
                    const data = doc.data();
                    // Fallback to schema mapping
                    return { ...data, id: data.student_id || doc.id };
                });
            });
            // Listen to logs
            window.db.collection('attendance_logs').orderBy('entry_time', 'desc').onSnapshot(snap => {
                this.attendanceLogs = snap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        firebase_id: doc.id,
                        ...data,
                        entry_time: data.entry_time ? data.entry_time.toDate() : null,
                        exit_time: data.exit_time ? data.exit_time.toDate() : null
                    };
                });
                this.updateView(); // Auto-refresh all UI screens instantly like React!
                if (document.getElementById('gatekeeper-profile-modal') && document.getElementById('gatekeeper-profile-modal').classList.contains('show')) {
                    this.renderGatekeeperLogs();
                }
            });
            
            // Listen to notifications
            window.db.collection('notifications').orderBy('createdAt', 'desc').onSnapshot(snap => {
                this.notifications = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const path = window.location.pathname;
                if (path.includes('notifications')) {
                    if (typeof this.renderNotificationsTables === 'function') this.renderNotificationsTables();
                }
            });

            // Listen to notification_receipts
            window.db.collection('notification_receipts').onSnapshot(snap => {
                this.notificationReceipts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (this.currentRole === 'parent') {
                    if (typeof this.renderParentNotifications === 'function') this.renderParentNotifications();
                }
            });

            // Listen to classes
            window.db.collection('classes').onSnapshot(snap => {
                this.classes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const path = window.location.pathname;
                if (path.includes('classes')) {
                    if (typeof this.renderClasses === 'function') this.renderClasses();
                }
            });
            
            // Check if schema is empty and auto-bootstrap mock data into real database
            const userSnap = await window.db.collection('users').limit(1).get();
            if (userSnap.empty) {
                console.log("Empty DB detected. Bootstrapping mock data...");
                this.bootstrapFirebase();
            }
        } catch(e) {
            console.error("Firebase connection error: ", e);
            this.showToast("Database connection error.", "error");
        }
    }

    async bootstrapFirebase() {
        this.showToast("Initializing empty Database. Please wait...", "warning");
        const initSchools = [
            { name: "Springfield High", id: "SCH001" },
            { name: "Riverside Academy", id: "SCH002" }
        ];
        for (let s of initSchools) await window.db.collection('schools').add(s);

        const initUsers = [
            { role: 'superadmin', phone_number: '+1999999999' },
            { role: 'admin', phone_number: '+1000000000', school_id: "SCH001" },
            { role: 'gatekeeper', phone_number: '+1000000001', school_id: "SCH001" },
            { role: 'parent', phone_number: '+1234567890', linked_student_ids: ['STU001', 'STU002'] }
        ];
        for (let u of initUsers) await window.db.collection('users').add(u);
        
        for (let i = 1; i <= 20; i++) {
            const sid = `STU${i.toString().padStart(3, '0')}`;
            await window.db.collection('students').add({
                student_id: sid,
                name: `Student ${i}`,
                class: ['10A', '8B', '12C', '9A', '11B'][i % 5],
                parent_phone: `+1800555${i.toString().padStart(4, '0')}`,
                qr_code_hash: `QR_${sid}`
            });
        }
        this.showToast("Database Ready!", "success");
    }

    init() {
        this.loadFirebaseData();
        
        const session = localStorage.getItem('safegate_session');
        if (session) {
            try {
                this.currentUser = JSON.parse(session);
                this.setRole(this.currentUser.role);
                return;
            } catch (e) { /* invalid session */ }
        }

        // Show login view if no session
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        const lv = document.getElementById('login-view');
        if (lv) lv.classList.add('active');
    }

    requestOTP() {
        const phone = document.getElementById('login-phone').value.trim();
        const user = this.users.find(u => u.phone_number === phone);
        if (!user) {
            this.showToast('Phone number not recognized in system', 'warning');
            return;
        }

        if ((user.role === 'gatekeeper' || user.role === 'admin') && user.status === 'inactive') {
            this.showToast('Account disabled remotely. Contact Superadmin.', 'error');
            return;
        }

        // Simulate sending OTP
        this.loginTempUser = user;
        this.showToast(`Simulated: OTP 1234 sent to ${phone}`, 'success');

        document.getElementById('login-phone-step').style.display = 'none';
        document.getElementById('login-otp-step').style.display = 'block';
    }

    verifyOTP() {
        const otp = document.getElementById('login-otp').value.trim();
        if (otp === '1234' && this.loginTempUser) {
            this.currentUser = this.loginTempUser;
            localStorage.setItem('safegate_session', JSON.stringify(this.currentUser));
            this.setRole(this.currentUser.role);
            this.showToast('Secure Login Successful', 'success');
        } else {
            this.showToast('Invalid OTP entered', 'warning');
        }
    }

    resetLoginStep() {
        this.loginTempUser = null;
        const otpInput = document.getElementById('login-otp');
        const phoneStep = document.getElementById('login-phone-step');
        const otpStep = document.getElementById('login-otp-step');
        
        if (otpInput) otpInput.value = '';
        if (phoneStep) phoneStep.style.display = 'block';
        if (otpStep) otpStep.style.display = 'none';
    }

    async logout() {
        try {
            await firebase.auth().signOut();
        } catch (e) {
            console.error("Firebase logout error:", e);
        }
        
        this.currentUser = null;
        this.currentRole = null;
        this.loginTempUser = null;
        localStorage.removeItem('safegate_session');

        const phoneInput = document.getElementById('login-phone');
        if (phoneInput) phoneInput.value = '';
        
        this.resetLoginStep();
        
        const path = window.location.pathname;
        if (path.includes('admin-')) {
            window.location.href = 'index.html';
            return;
        }
        
        this.init();
        this.showToast('Logged out securely', 'info');
    }

    setRole(role) {
        if (role === 'parent' && !this.featureFlags.allowParentPortal) {
            this.showToast('Parent Web Portal is currently offline', 'error');
            this.logout();
            return;
        }

        this.currentRole = role;

        // Hide all screens
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));

        // Show specific screen
        const viewId = `${role}-view`;
        const v = document.getElementById(viewId);
        if (v) v.classList.add('active');

        // Render Data based on View
        this.updateView();
    }

    updateView() {
        if (this.currentRole === 'superadmin') this.renderSuperAdmin();
        if (this.currentRole === 'gatekeeper') this.renderGatekeeper();
        if (this.currentRole === 'admin') {
            const path = window.location.pathname;
            if (!path.includes('admin-')) {
                window.location.href = 'admin-dashboard.html';
                return;
            }
            
            // Mark active sidebar item based on URL
            document.querySelectorAll('.sidebar-nav-item').forEach(nav => nav.classList.remove('active'));
            if (path.includes('dashboard')) {
                const nav = document.getElementById('nav-page-dashboard');
                if (nav) nav.classList.add('active');
                this.renderDashboard();
            } else if (path.includes('students')) {
                const nav = document.getElementById('nav-page-students');
                if (nav) nav.classList.add('active');
                this.renderStudentDirectory();
            } else if (path.includes('gatekeepers')) {
                const nav = document.getElementById('nav-page-gatekeepers');
                if (nav) nav.classList.add('active');
                this.renderGatekeepers();
            } else if (path.includes('parents')) {
                const nav = document.getElementById('nav-page-parents');
                if (nav) nav.classList.add('active');
                this.renderParents();
            } else if (path.includes('id-cards')) {
                const nav = document.getElementById('nav-page-id-cards');
                if (nav) nav.classList.add('active');
                if (typeof this.renderGenerateIDStudentList === 'function') this.renderGenerateIDStudentList(); 
            } else if (path.includes('id-design')) {
                // Nothing special to render on load for id-design yet
            } else if (path.includes('attendance')) {
                const nav = document.getElementById('nav-page-attendance');
                if (nav) nav.classList.add('active');
                this.renderAttendanceLogs();
            } else if (path.includes('notifications')) {
                const nav = document.getElementById('nav-page-notifications');
                if (nav) nav.classList.add('active');
                if (typeof this.renderNotificationsTables === 'function') this.renderNotificationsTables();
                if (typeof this.handleNotificationTargetChange === 'function') this.handleNotificationTargetChange();
            } else if (path.includes('classes')) {
                const nav = document.getElementById('nav-page-classes');
                if (nav) nav.classList.add('active');
                if (typeof this.renderClasses === 'function') this.renderClasses();
            } else if (path.includes('settings')) {
                const nav = document.getElementById('nav-page-settings');
                if (nav) nav.classList.add('active');
                this.renderSettings();
            }
        }
        if (this.currentRole === 'parent') this.renderParent();
    }

    async simulateAutomaticScan() {
        if (!this.featureFlags.allowGatekeeperScanning) {
            this.showToast('Scanning System blocked by Superadmin', 'error');
            return;
        }

        if (this.students.length === 0) return; // Wait for DB load
        
        // 10% chance to simulate a bad scan / student not found
        if (Math.random() < 0.1) {
            this.showScanFeedback(null, 'error', 'Student Not Found', 'Invalid QR code');
            return;
        }

        const student = this.students[Math.floor(Math.random() * this.students.length)];
        let latestLog = this.attendanceLogs.find(log => log.student_id === student.id && log.status === 'inside');

        if (latestLog) {
            const currentHour = new Date().getHours();
            const schoolEndHour = 15; // 3:00 PM

            if (currentHour >= schoolEndHour) {
                // Exit marked automatically if after hours
                const exitTime = new Date();
                await window.db.collection('attendance_logs').doc(latestLog.firebase_id).update({
                    exit_time: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'outside',
                    exit_scanned_by: this.currentUser ? this.currentUser.id : null
                });
                
                this.showScanFeedback(student, 'success', 'Exit Recorded', 'Valid checkout');
                this.notifyParent(student, 'outside', exitTime);
            } else {
                // Already inside
                this.showScanFeedback(student, 'warning', 'Already inside', 'Duplicate entry attempt');
            }
        } else {
            // Mark entry
            const entryTime = new Date();
            await window.db.collection('attendance_logs').add({
                student_id: student.id,
                entry_time: firebase.firestore.FieldValue.serverTimestamp(),
                exit_time: null,
                status: 'inside',
                scanned_by: this.currentUser ? this.currentUser.id : null
            });
            
            this.showScanFeedback(student, 'success', 'Entry Recorded', 'Valid checkin');
            this.notifyParent(student, 'inside', entryTime);
        }
    }

    notifyParent(student, type, time) {
        if (!this.featureFlags.allowParentNotifications) return;
        
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let message;

        if (type === 'inside') {
            message = `Your child ${student.name} (Class ${student.class}) entered school at ${timeStr}`;
        } else {
            message = `Your child ${student.name} exited school at ${timeStr}`;
        }

        // Simulating push/SMS notification pop-up dynamically on screen 
        this.showToast(`📱 SMS to ${student.parent_phone}: ${message}`, 'success');
    }

    showScanFeedback(student, type, titleText, statusMessage) {
        const modal = document.getElementById('scan-modal');
        const icon = document.getElementById('scan-result-icon');
        const title = document.getElementById('scan-result-title');

        if (student) {
            const initials = student.name.split(' ').map(n => n[0]).join('');
            document.getElementById('scan-avatar').innerText = initials;
            document.getElementById('scan-avatar').className = 'avatar mock-bg';
            document.getElementById('scan-student-name').innerText = student.name;
            document.getElementById('scan-student-details').innerText = `Class ${student.class} • ${student.id}`;
        } else {
            document.getElementById('scan-avatar').innerText = '?';
            document.getElementById('scan-avatar').className = 'avatar mock-bg';
            document.getElementById('scan-student-name').innerText = 'Unknown';
            document.getElementById('scan-student-details').innerText = '';
        }

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        document.getElementById('scan-timestamp').innerText = `${timeStr} • ${statusMessage}`;

        if (type === 'success') {
            icon.className = 'result-icon success';
            icon.innerHTML = '<i class="fa-solid fa-check-circle"></i>';
            icon.style.color = '#10b981'; // Green
        } else if (type === 'warning') {
            icon.className = 'result-icon warning';
            icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            icon.style.color = '#f59e0b'; // Yellow
        } else if (type === 'error') {
            icon.className = 'result-icon error';
            icon.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
            icon.style.color = '#ef4444'; // Red
        }

        title.innerText = titleText;
        modal.classList.add('show');

        // Play haptic + sound feedback
        this.playAudioFeedback(type);
        if (navigator.vibrate) {
            if (type === 'success') navigator.vibrate(150);
            else navigator.vibrate([200, 100, 200]);
        }

        // Clear previous timeout to prevent modal glitching during rapid scanning bursts
        if (this.scanModalTimeout) clearTimeout(this.scanModalTimeout);

        // Reset scanner ultra-fast for next student
        this.scanModalTimeout = setTimeout(() => {
            modal.classList.remove('show');
        }, 800);
    }

    playAudioFeedback(type) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'success') {
                osc.frequency.value = 800; // High success beep
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.15);
            } else {
                osc.frequency.value = 300; // Low error/warning buzz
                osc.type = 'square';
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.3);
            }
        } catch (e) { console.error('Audio feedback not supported', e); }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');

        // Prevent toast DOM spam during rapid mass usage
        if (container.children.length >= 3) {
            container.removeChild(container.firstChild);
        }

        const toast = document.createElement('div');
        toast.className = 'toast';

        const icon = type === 'success' ? '<i class="fa-solid fa-check-circle" style="color:var(--success)"></i>' :
            type === 'warning' ? '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i>' :
                '<i class="fa-solid fa-info-circle"></i>';

        toast.innerHTML = `${icon} <span>${message}</span>`;

        container.appendChild(toast);

        // Remove after animation
        setTimeout(() => {
            if (container.contains(toast)) container.removeChild(toast);
        }, 3000);
    }

    // --- Render View Methods ---

    renderGatekeeper() {
        const list = document.getElementById('gk-history-list');
        const todayCount = document.getElementById('gk-today-count');

        // We need to collate physical scans (both entries and exits) from the logs
        const events = [];
        this.attendanceLogs.forEach(log => {
            if (log.entry_time) events.push({ studentId: log.student_id, type: 'inside', timestamp: log.entry_time });
            if (log.exit_time) events.push({ studentId: log.student_id, type: 'outside', timestamp: log.exit_time });
        });
        events.sort((a, b) => b.timestamp - a.timestamp); // newest first

        todayCount.innerText = `${events.length} today`;

        if (events.length === 0) {
            list.innerHTML = '<div class="empty-state">No scans yet today.</div>';
            return;
        }

        list.innerHTML = events.slice(0, 10).map(scan => {
            const student = this.students.find(s => s.id === scan.studentId);
            const timeStr = scan.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const actionClass = scan.type === 'inside' ? 'action-in' : 'action-out';
            const actionText = scan.type === 'inside' ? 'Entered' : 'Left';
            const actionIcon = scan.type === 'inside' ? 'fa-arrow-right-to-bracket' : 'fa-arrow-right-from-bracket';
            const initials = student.name.split(' ').map(n => n[0]).join('');

            return `
                <li class="history-item">
                    <div class="avatar bg-gradient">${initials}</div>
                    <div class="history-info">
                        <div class="history-name">${student.name}</div>
                        <div class="history-time">${timeStr} • ${student.class}</div>
                    </div>
                    <div class="history-action ${actionClass}">
                        <i class="fa-solid ${actionIcon}"></i> ${actionText}
                    </div>
                </li>
            `;
        }).join('');
    }

    renderDashboard() {
        const managedStudents = this.students.filter(s => s.school_id === this.currentUser.school_id);
        const managedStudentIds = new Set(managedStudents.map(s => s.id));
        const managedLogs = this.attendanceLogs.filter(log => managedStudentIds.has(log.student_id));

        const total = managedStudents.length;

        const todayLogs = managedLogs;
        const presentTodayIds = new Set(todayLogs.map(l => l.student_id));
        const presentToday = presentTodayIds.size;

        const missing = total - presentToday;
        const inSchool = managedLogs.filter(log => log.status === 'inside').length;

        document.getElementById('admin-stat-total').innerText = total;
        document.getElementById('admin-stat-present').innerText = presentToday;
        document.getElementById('admin-stat-missing').innerText = missing;
        document.getElementById('admin-stat-in').innerText = inSchool;
    }

    renderStudentDirectory() {
        const managedStudents = this.students.filter(s => s.school_id === this.currentUser.school_id);
        
        const query = (document.getElementById('directory-search').value || '').toLowerCase();
        const classFilterEl = document.getElementById('directory-class-filter');
        
        if (classFilterEl && classFilterEl.options.length <= 1) {
            const schoolClasses = this.classes.filter(c => c.schoolId === this.currentUser.school_id).sort((a, b) => {
                if(a.name === b.name) return a.section.localeCompare(b.section);
                return a.name.localeCompare(b.name, undefined, {numeric: true});
            });
            schoolClasses.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.displayName; opt.innerText = c.displayName;
                classFilterEl.appendChild(opt);
            });
        }
        const fClass = classFilterEl ? classFilterEl.value : 'all';

        let displayData = managedStudents;
        if (query) {
            displayData = displayData.filter(s => (s.name && s.name.toLowerCase().includes(query)) || s.id.toLowerCase().includes(query));
        }
        if (fClass !== 'all') {
            displayData = displayData.filter(s => s.class === fClass);
        }

        const tbody = document.getElementById('student-directory-body');
        if (displayData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center empty-state">No students found.</td></tr>';
            return;
        }

        tbody.innerHTML = displayData.map(s => `
            <tr>
                <td><img src="${s.photo_url || 'https://ui-avatars.com/api/?name=' + s.name}" class="avatar"></td>
                <td><div style="font-weight: 500">${s.name}</div><div style="font-size:0.75rem; color:var(--text-muted)">${s.id}</div></td>
                <td>${s.class}</td>
                <td>${s.contact_number || '-'}</td>
                <td style="text-align: right;">
                    <button class="icon-btn text-primary" onclick="app.selectedGenerateStudent='${s.id}'; app.navigateToAdminPage('id-cards'); app.renderGenerateIDStudentList();" title="Generate ID"><i class="fa-solid fa-id-card"></i></button>
                    <button class="icon-btn text-blue" onclick="app.openManageStudentModal('${s.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="icon-btn text-danger" onclick="app.deleteStudent('${s.id}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    }

    renderAttendanceLogs() {
        const managedStudents = this.students.filter(s => s.school_id === this.currentUser.school_id);
        const managedStudentIds = new Set(managedStudents.map(s => s.id));
        const managedLogs = this.attendanceLogs.filter(log => managedStudentIds.has(log.student_id));

        // Populate class filters if empty
        const classFilter = document.getElementById('filter-class');
        if (classFilter.options.length <= 1) {
            const classes = [...new Set(managedStudents.map(s => s.class))].sort();
            classes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; opt.innerText = c;
                classFilter.appendChild(opt);
            });
            document.getElementById('filter-date').valueAsDate = new Date();
        }

        const fClass = classFilter.value;
        const fStatus = document.getElementById('filter-status').value;

        const feed = document.getElementById('admin-live-feed');

        let displayData = managedStudents.map(student => {
            const latestLog = managedLogs.find(l => l.student_id === student.id);
            return { student, log: latestLog || null };
        });

        if (fClass !== 'all') {
            displayData = displayData.filter(item => item.student.class === fClass);
        }
        if (fStatus !== 'all') {
            displayData = displayData.filter(item => {
                if (fStatus === 'inside') return item.log && item.log.status === 'inside';
                if (fStatus === 'outside') return item.log && item.log.status === 'outside';
                if (fStatus === 'not_arrived') return !item.log;
                return true;
            });
        }

        if (displayData.length === 0) {
            feed.innerHTML = '<tr><td colspan="6" class="text-center empty-state">No records match filters.</td></tr>';
            return;
        }

        feed.innerHTML = displayData.map(item => {
            const s = item.student;
            const log = item.log;

            const entryStr = log && log.entry_time ? log.entry_time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
            const exitStr = log && log.exit_time ? log.exit_time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';

            const isInside = log && log.status === 'inside';
            const badgeClass = isInside ? 'success' : 'danger';
            const textStatus = isInside ? 'Inside' : (log ? 'Outside' : 'Not Arrived');
            const badgeColor = log ? badgeClass : 'warning';

            return `
                <tr>
                    <td><div style="font-weight: 500">${s.name}</div><div style="font-size:0.75rem; color:var(--text-muted)">${s.id}</div></td>
                    <td>${s.class}</td>
                    <td>${entryStr}</td>
                    <td>${exitStr}</td>
                    <td><span class="badge ${badgeColor}-badge">${textStatus}</span></td>
                    <td>
                        <div class="table-actions">
                            <button class="action-btn" title="View Profile & QR Code" onclick="app.openStudentModal('${s.id}')"><i class="fa-solid fa-qrcode"></i></button>
                            <button class="action-btn" title="Edit Student" onclick="app.openManageStudentModal('${s.id}')"><i class="fa-solid fa-pen text-blue"></i></button>
                            <button class="action-btn" title="Delete Student" onclick="app.deleteStudent('${s.id}')"><i class="fa-solid fa-trash text-danger"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // --- STUDENT CRUD LOGIC ---

    openManageStudentModal(studentId = null) {
        document.getElementById('student-doc-id').value = '';
        document.getElementById('stu-name').value = '';
        document.getElementById('stu-parent-phone').value = '';

        const classSelect = document.getElementById('stu-class');
        if (classSelect) {
            // For new students, we prefer active classes, but for edits we might need to show the assigned class even if inactive
            const schoolClasses = this.classes.filter(c => c.schoolId === this.currentUser.school_id);
            schoolClasses.sort((a, b) => {
                if(a.name === b.name) return a.section.localeCompare(b.section);
                return a.name.localeCompare(b.name, undefined, {numeric: true});
            });
            classSelect.innerHTML = `<option value="">Select a Class</option>` + 
                schoolClasses.map(c => `<option value="${c.displayName}">${c.displayName} ${c.status==='inactive'?'(Inactive)':''}</option>`).join('');
        }
        
        if (studentId) {
            document.getElementById('student-modal-title').innerText = "Edit Student";
            document.getElementById('stu-readonly-id').value = studentId;
            const s = this.students.find(x => x.id === studentId);
            if (s) {
                document.getElementById('student-doc-id').value = s.id;
                document.getElementById('stu-name').value = s.name;
                
                // Add the class if it doesn't exist in the list (e.g. legacy data)
                if (classSelect && s.class && !Array.from(classSelect.options).some(o => o.value === s.class)) {
                     classSelect.innerHTML += `<option value="${s.class}">${s.class} (Legacy)</option>`;
                }
                if (classSelect) document.getElementById('stu-class').value = s.class;
                
                document.getElementById('stu-parent-phone').value = s.parent_phone;
            }
        } else {
            document.getElementById('student-modal-title').innerText = "Add New Student";
            const newId = "STU" + Math.floor(1000 + Math.random() * 9000);
            document.getElementById('stu-readonly-id').value = newId;
            if (classSelect) classSelect.value = '';
        }

        document.getElementById('manage-student-modal').classList.add('show');
    }

    closeManageStudentModal() {
        document.getElementById('manage-student-modal').classList.remove('show');
    }

    async saveStudent(event) {
        event.preventDefault();
        const docId = document.getElementById('student-doc-id').value;
        const phone = document.getElementById('stu-parent-phone').value;
        const data = {
            name: document.getElementById('stu-name').value,
            class: document.getElementById('stu-class').value,
            parent_phone: phone,
            school_id: this.currentUser.school_id
        };

        try {
            if (docId) {
                await window.db.collection('students').doc(docId).update(data);
                this.showToast('Student updated successfully!', 'success');
            } else {
                const studentId = document.getElementById('stu-readonly-id').value;
                data.student_id = studentId;
                data.qr_code_hash = "QR_" + studentId;
                await window.db.collection('students').doc(studentId).set(data);
                
                const parentSnap = await window.db.collection('users').where('phone_number', '==', phone).get();
                if (parentSnap.empty) {
                    await window.db.collection('users').add({
                        role: 'parent',
                        phone_number: phone,
                        linked_student_id: studentId
                    });
                }
                this.showToast('New student registered!', 'success');
            }
            this.closeManageStudentModal();
        } catch(e) {
            this.showToast('Error saving student', 'error');
        }
    }

    renderParents() {
        const searchInput = document.getElementById('parent-search');
        const query = (searchInput ? searchInput.value : '').toLowerCase();
        const tbody = document.getElementById('parents-table-body');
        if (!tbody) return;
        
        let parents = this.users.filter(u => u.role === 'parent');
        
        if (query) {
            parents = parents.filter(u => u.phone_number?.toLowerCase().includes(query));
        }

        if (parents.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No parents found</td></tr>`;
            return;
        }

        tbody.innerHTML = parents.map(p => {
            const linkedStudent = this.students.find(s => s.id === p.linked_student_id || s.student_id === p.linked_student_id) || { name: 'Unknown', class: 'N/A' };
            return `
                <tr>
                    <td>${p.phone_number || 'N/A'}</td>
                    <td>${linkedStudent.name} (${linkedStudent.class})</td>
                    <td style="text-align: right;">
                        <button class="icon-btn" onclick="app.openManageParentModal('${p.id}')"><i class="fa-solid fa-pen text-blue"></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    openManageParentModal(id = null) {
        const form = document.getElementById('parent-form');
        if (form) form.reset();
        
        const docIdEl = document.getElementById('parent-doc-id');
        if(docIdEl) docIdEl.value = id || '';
        
        const titleEl = document.getElementById('parent-modal-title');
        if(titleEl) titleEl.innerText = id ? "Edit Parent" : "Add Parent";
        
        const studentCheckboxes = document.getElementById('parent-student-checkboxes');
        if (studentCheckboxes) {
            const schoolStudents = this.students.filter(s => s.school_id === this.currentUser.school_id);
            studentCheckboxes.innerHTML = schoolStudents.map(s => `
                <div style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <input type="radio" name="linked_student" value="${s.id}" id="stu_radio_${s.id}">
                    <label for="stu_radio_${s.id}" class="text-muted" style="font-size:0.85rem; margin:0;">${s.name} (${s.class})</label>
                </div>
            `).join('');
        }

        if (id) {
            const p = this.users.find(u => u.id === id);
            if (p) {
                const phoneInput = document.getElementById('parent-phone');
                if(phoneInput) phoneInput.value = p.phone_number || '';
                
                if (p.linked_student_id) {
                    const radio = document.getElementById(`stu_radio_${p.linked_student_id}`);
                    if (radio) radio.checked = true;
                }
            }
        }
        
        const m = document.getElementById('manage-parent-modal');
        if(m) m.classList.add('show');
    }

    closeManageParentModal() {
        const m = document.getElementById('manage-parent-modal');
        if(m) m.classList.remove('show');
    }

    async saveParent(event) {
        event.preventDefault();
        const docId = document.getElementById('parent-doc-id').value;
        const phone = document.getElementById('parent-phone').value;
        const linkedStudent = document.querySelector('input[name="linked_student"]:checked');
        
        const data = {
            role: 'parent',
            phone_number: phone,
            linked_student_id: linkedStudent ? linkedStudent.value : null
        };

        try {
            if (docId) {
                await window.db.collection('users').doc(docId).update(data);
                this.showToast('Parent updated successfully!', 'success');
            } else {
                await window.db.collection('users').add(data);
                this.showToast('Parent mapped successfully!', 'success');
            }
            this.closeManageParentModal();
        } catch (e) {
            this.showToast('Error saving parent', 'error');
        }
    }

    async deleteStudent(studentId) {
        if(confirm("Are you sure you want to completely remove this student record?")) {
            try {
                await window.db.collection('students').doc(studentId).delete();
                this.showToast("Student deleted permanently.", "info");
            } catch(e) {
                this.showToast("Failed to delete student", "error");
            }
        }
    }


    renderParent() {
        // Securely fetch parent user details from the active session
        let parentUser = this.currentUser;
        if (!parentUser || parentUser.role !== 'parent') {
            // Demo fallback just in case testing gets weird
            parentUser = this.users.find(u => u.role === 'parent');
        }

        const mappedIds = parentUser.linked_student_ids || (parentUser.linked_student_id ? [parentUser.linked_student_id] : []);
        const myStudent = this.students.find(s => mappedIds.includes(s.id));

        if (!myStudent) {
            document.querySelector('.pad-content').innerHTML = '<div class="glass-panel text-center"><h3>No Linked Students</h3><p class="text-muted">Please contact your school administrator for mapping.</p></div>';
            return;
        }

        // Get logs for this student
        const myLogs = this.attendanceLogs.filter(log => log.student_id === myStudent.id);

        // Student is inside if their most recent log has status 'inside'
        const isInside = myLogs.some(log => log.status === 'inside');

        // Update Header
        document.getElementById('parent-student-name').innerText = myStudent.name;

        // Update Status Badge
        const badge = document.getElementById('parent-status-badge');
        if (isInside) {
            badge.className = 'status-badge in';
            badge.innerHTML = '<i class="fa-solid fa-school"></i> In School';
        } else {
            badge.className = 'status-badge out';
            badge.innerHTML = '<i class="fa-solid fa-house"></i> Not in School';
        }

        // Render Timeline
        const timeline = document.getElementById('parent-timeline');
        const events = [];
        myLogs.forEach(log => {
            if (log.entry_time) events.push({ type: 'inside', timestamp: log.entry_time });
            if (log.exit_time) events.push({ type: 'outside', timestamp: log.exit_time });
        });
        events.sort((a, b) => b.timestamp - a.timestamp);

        if (events.length === 0) {
            timeline.innerHTML = '<div class="timeline-empty empty-state">No activity today.</div>';
            return;
        }

        timeline.innerHTML = events.map(scan => {
            const isEntry = scan.type === 'inside';
            const timeStr = scan.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="timeline-item">
                    <div class="timeline-dot ${isEntry ? 'success' : 'warning'}"></div>
                    <div class="timeline-content">
                        <h4>${isEntry ? 'Safely Arrived at School' : 'Left School Premises'}</h4>
                        <p>${timeStr} • Gate 1</p>
                    </div>
                </div>
            `;
        }).join('');
    }

    raiseCorrectionRequest() {
        this.showToast('Request submitted to School Admin for review!', 'success');
    }

    openStudentModal(studentId) {
        if (!this.featureFlags.allowStudentProfiles) {
            this.showToast('Student Profiles disabled by Superadmin', 'warning');
            return;
        }
        
        const student = this.students.find(s => s.id === studentId);
        if (!student) return;

        this.currentProfileStudent = student;
        const initials = student.name.split(' ').map(n => n[0]).join('');
        document.getElementById('profile-avatar').innerText = initials;
        document.getElementById('profile-name').innerText = student.name;
        document.getElementById('profile-details').innerText = `Class ${student.class} • ${student.id}`;

        // Dynamically request a real generated QR code carrying the Student ID using a public API
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&color=0f172a&bgcolor=ffffff&data=${encodeURIComponent(student.id)}`;
        document.getElementById('profile-qr-img').src = qrUrl;

        document.getElementById('student-modal').classList.add('show');
    }

    closeStudentModal() {
        document.getElementById('student-modal').classList.remove('show');
    }

    async downloadQRCode() {
        if (!this.currentProfileStudent) return;
        const url = document.getElementById('profile-qr-img').src;
        try {
            // Fetch the image to bypass basic cross-origin direct link blocks
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${this.currentProfileStudent.name.replace(' ', '_')}_QRCode.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            this.showToast(`Saved QR Code for ${this.currentProfileStudent.name}`, 'success');
        } catch (e) {
            // Fallback
            window.open(url, '_blank');
        }
    }

    printQRCode() {
        if (!this.currentProfileStudent) return;
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html><head><title>Print QR - ${this.currentProfileStudent.name}</title></head>
            <body style="text-align: center; font-family: sans-serif; padding: 50px;">
                <h1>${this.currentProfileStudent.name}</h1>
                <p>Class ${this.currentProfileStudent.class} • ID: ${this.currentProfileStudent.id}</p>
                <img src="${document.getElementById('profile-qr-img').src}" width="300" height="300" style="margin-top:20px;" />
                <script>setTimeout(() => { window.print(); window.close(); }, 500);</script>
            </body>
            </html>
        `);
    }

    renderSuperAdmin() {
        document.getElementById('flag-scan').checked = this.featureFlags.allowGatekeeperScanning;
        document.getElementById('flag-notify').checked = this.featureFlags.allowParentNotifications;
        document.getElementById('flag-profiles').checked = this.featureFlags.allowStudentProfiles;
        document.getElementById('flag-parent-portal').checked = this.featureFlags.allowParentPortal;
    }

    toggleFeature(flagKey, state) {
        this.featureFlags[flagKey] = state;
        localStorage.setItem('safegate_flags', JSON.stringify(this.featureFlags));
        this.showToast(`System Block: ${state ? 'ENABLED' : 'DISABLED'}`, 'success');
    }

    // --- GATEKEEPER MANAGEMENT (ADMIN) ---

    navigateToAdminPage(pageId) {
        window.location.href = `admin-${pageId}.html`;
    }

    showManageGatekeepers() {
        this.navigateToAdminPage('gatekeepers');
    }

    showManageParents() {
        this.navigateToAdminPage('parents');
    }

    renderSettings() {
        const school = this.schools.find(s => s.id === this.currentUser.school_id);
        if(school) {
            document.getElementById('settings-school-name').value = school.name || '';
        }
    }

    renderGatekeepers() {
        const query = (document.getElementById('gk-search').value || '').toLowerCase();
        const statusFilter = document.getElementById('gk-filter-status').value;
        const tbody = document.getElementById('gatekeepers-table-body');
        
        let gatekeepers = this.users.filter(u => u.role === 'gatekeeper' && u.school_id === this.currentUser.school_id);
        
        if (query) {
            gatekeepers = gatekeepers.filter(gk => 
                (gk.name && gk.name.toLowerCase().includes(query)) || 
                (gk.phone_number.includes(query))
            );
        }
        if (statusFilter !== 'all') {
            gatekeepers = gatekeepers.filter(gk => (gk.status || 'active') === statusFilter);
        }
        
        if (gatekeepers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No Gatekeepers found matching filters</td></tr>`;
            return;
        }

        tbody.innerHTML = gatekeepers.map(gk => {
            const isActive = (gk.status || 'active') === 'active';
            
            return `
                <tr>
                    <td><strong>${gk.name || 'Unnamed Gatekeeper'}</strong></td>
                    <td>${gk.phone_number}</td>
                    <td>${gk.assigned_gate || 'Unassigned'}</td>
                    <td>
                        <span class="status-badge small ${isActive ? 'in' : 'out'} cursor-pointer" 
                              onclick="app.toggleGatekeeperStatus('${gk.id}', '${isActive ? 'inactive' : 'active'}')"
                              title="Click to toggle status" style="cursor: pointer;">
                            ${isActive ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td>
                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                            <button class="icon-btn" onclick="app.openGatekeeperProfile('${gk.id}')" title="View Logs">
                                <i class="fa-solid fa-clock-rotate-left text-green"></i>
                            </button>
                            <button class="icon-btn" onclick="app.openGatekeeperModal('${gk.id}')" title="Edit">
                                <i class="fa-solid fa-pen text-blue"></i>
                            </button>
                            <button class="icon-btn" onclick="app.deleteGatekeeper('${gk.id}')" title="Delete">
                                <i class="fa-solid fa-trash text-warning"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    openGatekeeperModal(gkId = null) {
        document.getElementById('gk-id').value = gkId || '';
        if (gkId) {
            const gk = this.users.find(u => u.id === gkId);
            document.getElementById('gk-name').value = gk.name || '';
            document.getElementById('gk-phone').value = gk.phone_number || '';
            document.getElementById('gk-gate').value = gk.assigned_gate || '';
            document.getElementById('gk-status').value = gk.status || 'active';
            document.getElementById('gk-modal-title').innerText = 'Edit Gatekeeper';
        } else {
            document.getElementById('gk-form').reset();
            document.getElementById('gk-status').value = 'active';
            document.getElementById('gk-modal-title').innerText = 'Add Gatekeeper';
        }
        document.getElementById('gatekeeper-modal').classList.add('show');
    }

    closeGatekeeperModal() {
        document.getElementById('gatekeeper-modal').classList.remove('show');
    }

    async saveGatekeeper() {
        const id = document.getElementById('gk-id').value;
        const name = document.getElementById('gk-name').value.trim();
        const phone = document.getElementById('gk-phone').value.trim();
        const gate = document.getElementById('gk-gate').value.trim();
        const status = document.getElementById('gk-status').value;

        // Validation - Unique Phone
        const exists = this.users.find(u => u.phone_number === phone && u.id !== id);
        if (exists) {
            this.showToast("Phone number already exists in system", "error");
            return;
        }

        const data = {
            name: name,
            phone_number: phone,
            assigned_gate: gate,
            status: status,
            role: 'gatekeeper',
            school_id: this.currentUser.school_id
        };

        try {
            if (id) {
                await window.db.collection('users').doc(id).update(data);
                this.showToast("Gatekeeper updated successfully", "success");
            } else {
                data.created_at = firebase.firestore.FieldValue.serverTimestamp();
                await window.db.collection('users').add(data);
                this.showToast("Gatekeeper created successfully", "success");
            }
            this.closeGatekeeperModal();
        } catch (e) {
            this.showToast("Database error saving Gatekeeper", "error");
        }
    }

    async deleteGatekeeper(id) {
        if (confirm("Are you sure you want to delete this gatekeeper permanently?")) {
            try {
                await window.db.collection('users').doc(id).delete();
                this.showToast("Gatekeeper removed", "info");
            } catch (e) {
                this.showToast("Failed to delete", "error");
            }
        }
    }

    async toggleGatekeeperStatus(id, newStatus) {
        try {
            await window.db.collection('users').doc(id).update({ status: newStatus });
            this.showToast(`Status updated to ${newStatus}`, "success");
        } catch (e) {
            this.showToast("Failed to update status", "error");
        }
    }

    openGatekeeperProfile(gkId) {
        this.currentProfileGkId = gkId;
        const gk = this.users.find(u => u.id === gkId);
        if (!gk) return;

        document.getElementById('gk-profile-name').innerText = gk.name || gk.phone_number;
        document.getElementById('gk-profile-gate').innerText = gk.assigned_gate ? `Assigned to: ${gk.assigned_gate}` : 'Unassigned Gate';
        
        this.renderGatekeeperLogs();
        document.getElementById('gatekeeper-profile-modal').classList.add('show');
    }

    renderGatekeeperLogs() {
        if (!this.currentProfileGkId) return;
        const gkId = this.currentProfileGkId;
        const tbody = document.getElementById('gk-profile-logs-body');
        
        let logsList = [];
        this.attendanceLogs.forEach(log => {
            if (log.scanned_by === gkId && log.entry_time) {
                logsList.push({
                    student_id: log.student_id,
                    action: 'Entry',
                    time: log.entry_time
                });
            }
            if (log.exit_scanned_by === gkId && log.exit_time) {
                logsList.push({
                    student_id: log.student_id,
                    action: 'Exit',
                    time: log.exit_time
                });
            }
        });

        logsList = logsList.sort((a,b) => b.time - a.time);

        document.getElementById('gk-profile-stats').innerText = `${logsList.length} Total Scans`;

        if (logsList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">No scan history recorded yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = logsList.map(item => {
            const student = this.students.find(s => s.id === item.student_id);
            const stuName = student ? student.name : item.student_id;
            const timeStr = item.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = item.time.toLocaleDateString();
            
            return `
                <tr>
                    <td><strong>${stuName}</strong></td>
                    <td><span class="status-badge small ${item.action === 'Entry' ? 'in' : 'out'}">${item.action}</span></td>
                    <td class="text-muted"><small>${dateStr} ${timeStr}</small></td>
                </tr>
            `;
        }).join('');
    }

    closeGatekeeperProfile() {
        this.currentProfileGkId = null;
        document.getElementById('gatekeeper-profile-modal').classList.remove('show');
    }

    // --- ADMIN MANAGEMENT (SUPERADMIN) ---

    showManageAdmins() {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        document.getElementById('admins-view').classList.add('active');
        this.renderAdmins();
    }

    renderAdmins() {
        const query = (document.getElementById('admin-search').value || '').toLowerCase();
        const statusFilter = document.getElementById('admin-filter-status').value;
        const schoolFilter = document.getElementById('admin-filter-school').value;
        const tbody = document.getElementById('admins-table-body');
        const schoolSelect = document.getElementById('admin-filter-school');

        // Populate schools filter if needed
        if (schoolSelect.children.length <= 1 && this.schools.length > 0) {
            schoolSelect.innerHTML = '<option value="all">All Schools</option>' + 
                this.schools.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
        
        let admins = this.users.filter(u => u.role === 'admin');
        
        if (query) {
            admins = admins.filter(a => 
                (a.name && a.name.toLowerCase().includes(query)) || 
                (a.phone_number.includes(query))
            );
        }
        if (statusFilter !== 'all') {
            admins = admins.filter(a => (a.status || 'active') === statusFilter);
        }
        if (schoolFilter !== 'all') {
            admins = admins.filter(a => a.school_id === schoolFilter);
        }
        
        if (admins.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No Admins found matching filters</td></tr>`;
            return;
        }

        tbody.innerHTML = admins.map(a => {
            const isActive = (a.status || 'active') === 'active';
            const school = this.schools.find(s => s.id === a.school_id);
            const schoolName = school ? school.name : (a.school_id || 'Unassigned');
            const createdDate = a.created_at ? a.created_at.toDate().toLocaleDateString() : 'System Default';
            
            return `
                <tr>
                    <td><strong>${a.name || 'Unnamed Admin'}</strong></td>
                    <td>${a.phone_number}</td>
                    <td>${schoolName}</td>
                    <td>
                        <span class="status-badge small ${isActive ? 'in' : 'out'} cursor-pointer" 
                              onclick="app.toggleAdminStatus('${a.id}', '${isActive ? 'inactive' : 'active'}')"
                              title="Click to toggle status" style="cursor: pointer;">
                            ${isActive ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td class="text-muted"><small>${createdDate}</small></td>
                    <td>
                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                            <button class="icon-btn" onclick="app.openAdminModal('${a.id}')" title="Edit">
                                <i class="fa-solid fa-pen text-blue"></i>
                            </button>
                            <button class="icon-btn" onclick="app.deleteAdmin('${a.id}')" title="Delete">
                                <i class="fa-solid fa-trash text-warning"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    openAdminModal(aId = null) {
        document.getElementById('admin-id').value = aId || '';
        const schoolDropdown = document.getElementById('admin-school');
        
        if (this.schools.length > 0) {
            schoolDropdown.innerHTML = this.schools.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        } else {
            schoolDropdown.innerHTML = `<option value="">No Schools Available</option>`;
        }

        if (aId) {
            const a = this.users.find(u => u.id === aId);
            document.getElementById('admin-name').value = a.name || '';
            document.getElementById('admin-phone').value = a.phone_number || '';
            document.getElementById('admin-school').value = a.school_id || '';
            document.getElementById('admin-status').value = a.status || 'active';
            document.getElementById('admin-modal-title').innerText = 'Edit Admin';
        } else {
            document.getElementById('admin-form').reset();
            document.getElementById('admin-status').value = 'active';
            document.getElementById('admin-modal-title').innerText = 'Add Admin';
        }
        document.getElementById('admin-modal').classList.add('show');
    }

    closeAdminModal() {
        document.getElementById('admin-modal').classList.remove('show');
    }

    async saveAdmin() {
        const id = document.getElementById('admin-id').value;
        const name = document.getElementById('admin-name').value.trim();
        const phone = document.getElementById('admin-phone').value.trim();
        const schoolId = document.getElementById('admin-school').value;
        const status = document.getElementById('admin-status').value;

        if (!schoolId) {
            this.showToast("Please assign a valid school", "warning");
            return;
        }

        // Validation - Unique Phone
        const exists = this.users.find(u => u.phone_number === phone && u.id !== id);
        if (exists) {
            this.showToast("Phone number already exists in system", "error");
            return;
        }

        const data = {
            name: name,
            phone_number: phone,
            school_id: schoolId,
            status: status,
            role: 'admin'
        };

        try {
            if (id) {
                await window.db.collection('users').doc(id).update(data);
                this.showToast("Admin updated successfully", "success");
            } else {
                data.created_at = firebase.firestore.FieldValue.serverTimestamp();
                await window.db.collection('users').add(data);
                this.showToast("Admin created successfully", "success");
            }
            this.closeAdminModal();
        } catch (e) {
            this.showToast("Database error saving Admin", "error");
        }
    }

    async deleteAdmin(id) {
        if (confirm("Are you sure you want to delete this admin permanently?")) {
            try {
                await window.db.collection('users').doc(id).delete();
                this.showToast("Admin removed", "info");
            } catch (e) {
                this.showToast("Failed to delete", "error");
            }
        }
    }

    async toggleAdminStatus(id, newStatus) {
        try {
            await window.db.collection('users').doc(id).update({ status: newStatus });
            this.showToast(`Status updated to ${newStatus}`, "success");
        } catch (e) {
            this.showToast("Failed to update status", "error");
        }
    }

    // --- SCHOOLS MANAGEMENT (SUPERADMIN) ---

    showManageSchools() {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        document.getElementById('schools-view').classList.add('active');
        this.renderSchools();
    }

    renderSchools() {
        const query = (document.getElementById('school-search').value || '').toLowerCase();
        const statusFilter = document.getElementById('school-filter-status').value;
        const tbody = document.getElementById('schools-table-body');
        
        let filteredSchools = this.schools;
        
        if (query) {
            filteredSchools = filteredSchools.filter(s => 
                (s.name && s.name.toLowerCase().includes(query)) || 
                (s.city && s.city.toLowerCase().includes(query)) ||
                (s.contact_phone && s.contact_phone.includes(query))
            );
        }
        if (statusFilter !== 'all') {
            filteredSchools = filteredSchools.filter(s => (s.status || 'active') === statusFilter);
        }
        
        if (filteredSchools.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No Schools found matching filters</td></tr>`;
            return;
        }

        tbody.innerHTML = filteredSchools.map(s => {
            const isActive = (s.status || 'active') === 'active';
            const admin = this.users.find(u => u.id === s.adminId && u.role === 'admin');
            const adminName = admin ? admin.name || admin.phone_number : 'Unassigned';
            const createdDate = s.created_at && typeof s.created_at.toDate === 'function' ? s.created_at.toDate().toLocaleDateString() : 'System Default';
            
            return `
                <tr>
                    <td><strong>${s.name || 'Unnamed School'}</strong></td>
                    <td>${s.city || '-'}</td>
                    <td>${s.contact_phone || '-'}</td>
                    <td>${adminName}</td>
                    <td>
                        <span class="status-badge small ${isActive ? 'in' : 'out'} cursor-pointer" 
                              onclick="app.toggleSchoolStatus('${s.id}', '${isActive ? 'inactive' : 'active'}')"
                              title="Click to toggle status" style="cursor: pointer;">
                            ${isActive ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td class="text-muted"><small>${createdDate}</small></td>
                    <td>
                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                            <button class="icon-btn" onclick="app.openSchoolModal('${s.id}')" title="Edit">
                                <i class="fa-solid fa-pen text-blue"></i>
                            </button>
                            <button class="icon-btn" onclick="app.deleteSchool('${s.id}')" title="Delete">
                                <i class="fa-solid fa-trash text-warning"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    openSchoolModal(sId = null) {
        document.getElementById('school-id').value = sId || '';
        
        const adminDropdown = document.getElementById('school-admin');
        const admins = this.users.filter(u => u.role === 'admin');
        adminDropdown.innerHTML = `<option value="">-- No Admin Selected --</option>` + admins.map(a => `<option value="${a.id}">${a.name || a.phone_number}</option>`).join('');

        if (sId) {
            const s = this.schools.find(sc => sc.id === sId);
            document.getElementById('school-name').value = s.name || '';
            document.getElementById('school-address').value = s.address || '';
            document.getElementById('school-city').value = s.city || '';
            document.getElementById('school-state').value = s.state || '';
            document.getElementById('school-phone').value = s.contact_phone || '';
            document.getElementById('school-admin').value = s.adminId || '';
            document.getElementById('school-status').value = s.status || 'active';
            document.getElementById('school-modal-title').innerText = 'Edit School';
        } else {
            document.getElementById('school-form').reset();
            document.getElementById('school-status').value = 'active';
            document.getElementById('school-modal-title').innerText = 'Add School';
        }
        document.getElementById('school-modal').classList.add('show');
    }

    closeSchoolModal() {
        document.getElementById('school-modal').classList.remove('show');
    }

    async saveSchool() {
        const id = document.getElementById('school-id').value;
        const name = document.getElementById('school-name').value.trim();
        const address = document.getElementById('school-address').value.trim();
        const city = document.getElementById('school-city').value.trim();
        const state = document.getElementById('school-state').value.trim();
        const phone = document.getElementById('school-phone').value.trim();
        const adminId = document.getElementById('school-admin').value;
        const status = document.getElementById('school-status').value;

        if (!name || !city || !phone) {
            this.showToast("Missing required fields", "warning");
            return;
        }

        const data = {
            name: name,
            address: address,
            city: city,
            state: state,
            contact_phone: phone,
            adminId: adminId || null,
            status: status
        };

        try {
            let schoolDocId = id;

            if (id) {
                // Update specific school
                const oldSchool = this.schools.find(s => s.id === id);
                await window.db.collection('schools').doc(id).update(data);
                
                // Disassociate old admin if it changed
                if (oldSchool && oldSchool.adminId !== adminId && oldSchool.adminId) {
                    await window.db.collection('users').doc(oldSchool.adminId).update({ school_id: firebase.firestore.FieldValue.delete() });
                }
                this.showToast("School updated successfully", "success");
            } else {
                data.created_at = firebase.firestore.FieldValue.serverTimestamp();
                const docRef = await window.db.collection('schools').add(data);
                schoolDocId = docRef.id;
                this.showToast("School created successfully", "success");
            }

            // Sync the school_id into the target user
            if (adminId) {
                await window.db.collection('users').doc(adminId).update({ school_id: schoolDocId });
            }

            this.closeSchoolModal();
        } catch (e) {
            this.showToast("Database error saving School", "error");
        }
    }

    async deleteSchool(id) {
        if (confirm("Are you sure you want to delete this school permanently? All associated members may lose access mapping.")) {
            try {
                // Determine if any admins are mapped to this school to clean them up
                const adminsToClean = this.users.filter(u => u.school_id === id);
                for (let admin of adminsToClean) {
                     await window.db.collection('users').doc(admin.id).update({ school_id: firebase.firestore.FieldValue.delete() });
                }

                await window.db.collection('schools').doc(id).delete();
                this.showToast("School deleted", "info");
            } catch (e) {
                this.showToast("Failed to delete", "error");
            }
        }
    }

    async toggleSchoolStatus(id, newStatus) {
        try {
            await window.db.collection('schools').doc(id).update({ status: newStatus });
            this.showToast(`School marked as ${newStatus}`, "success");
        } catch (e) {
            this.showToast("Failed to update status", "error");
        }
    }

    // --- THEME MANAGEMENT SYSTEM ---
    
    applyTheme() {
        // 1. Resolve local device persistence or system default
        const savedMode = localStorage.getItem('safegate_theme');
        const systemMode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        const baseTheme = savedMode || systemMode;
        
        document.documentElement.setAttribute('data-theme', baseTheme);

        // 2. Resolve Global School Brand Overrides
        if (this.currentUser && this.currentUser.school_id) {
            const school = this.schools.find(s => s.id === this.currentUser.school_id);
            if (school && school.theme_primary) {
                // Apply overriding CSS variables dynamically
                document.documentElement.style.setProperty('--primary', school.theme_primary);
                document.documentElement.style.setProperty('--primary-glow', school.theme_primary + '66'); // alpha bleed
            } else {
                this.resetBrandTheme();
            }
        } else {
            this.resetBrandTheme();
        }
    }

    resetBrandTheme() {
        document.documentElement.style.removeProperty('--primary');
        document.documentElement.style.removeProperty('--primary-glow');
    }

    setBaseTheme(mode) {
        localStorage.setItem('safegate_theme', mode);
        this.applyTheme();
        this.showToast(`Switched to ${mode} mode`, "success");
    }

    openThemeSettings() {
        const isBrandManager = (this.currentUser.role === 'admin' || this.currentUser.role === 'superadmin') && this.currentUser.school_id;
        const brandSection = document.getElementById('brand-theme-section');
        
        if (isBrandManager) {
            brandSection.style.display = 'block';
            const school = this.schools.find(s => s.id === this.currentUser.school_id);
            document.getElementById('school-brand-color').value = school && school.theme_primary ? school.theme_primary : '#3b82f6';
        } else {
            brandSection.style.display = 'none'; // Superadmin no bound school or Parent
        }

        document.getElementById('theme-modal').classList.add('show');
    }

    closeThemeSettings() {
        document.getElementById('theme-modal').classList.remove('show');
    }

    async saveBrandColor() {
        const color = document.getElementById('school-brand-color').value;
        const schoolDoc = this.schools.find(s => s.id === this.currentUser.school_id);
        if (schoolDoc) {
            try {
                await window.db.collection('schools').doc(schoolDoc.id).update({
                    theme_primary: color
                });
                this.showToast('Brand color updated globally', 'success');
                this.closeThemeSettings();
            } catch (e) {
                this.showToast('Failed to update brand color', 'error');
            }
        }
    }

    // --- ID CARD CUSTOMIZATION ENGINE ---

    showIDTemplates() {
        if (!this.currentUser || !this.currentUser.school_id) {
            this.showToast("School ID not found", "error");
            return;
        }

        const school = this.schools.find(s => s.id === this.currentUser.school_id);
        this.currentIDLayout = school.id_card_template || 'vertical';
        
        document.getElementById('id-config-name').value = school.id_card_name || school.name || '';
        document.getElementById('id-config-address').value = school.id_card_address || school.address || '';
        document.getElementById('id-config-phone').value = school.id_card_phone || school.contact_phone || '';
        document.getElementById('id-config-color').value = school.id_card_primary_color || '#3b82f6';
        document.getElementById('id-config-logo').value = school.id_card_logo || 'https://ui-avatars.com/api/?name=S&background=random';

        document.querySelectorAll('#tab-id-design .mini-option').forEach(opt => opt.classList.remove('selected'));
        const activeOpt = document.getElementById(`opt-${this.currentIDLayout}`);
        if(activeOpt) activeOpt.classList.add('selected');

        this.updateIDPreview();
    }

    previewTemplate(layout) {
        this.currentIDLayout = layout;
        
        // Update selection UI
        document.querySelectorAll('.mini-option').forEach(opt => opt.classList.remove('selected'));
        const activeOpt = document.getElementById(`opt-${layout}`);
        if (activeOpt) activeOpt.classList.add('selected');

        this.updateIDPreview();
    }

    updateIDPreview() {
        const config = {
            layout: this.currentIDLayout,
            schoolName: document.getElementById('id-config-name').value || 'SPRINGFIELD HIGH',
            address: document.getElementById('id-config-address').value || '123 Education Lane',
            phone: document.getElementById('id-config-phone').value || '+1 800 555 0199',
            primaryColor: document.getElementById('id-config-color').value,
            logoUrl: document.getElementById('id-config-logo').value || 'https://ui-avatars.com/api/?name=S&background=random',
            studentName: 'Sample Student',
            studentId: 'SG-2026-001',
            studentClass: 'Grade 10-A',
            bloodGroup: 'O Positive',
            emergencyContact: '911-000',
            photoUrl: 'https://ui-avatars.com/api/?name=Sample+Student&background=ddd&color=333',
            qrCodeData: 'SG-2026-001'
        };

        const renderArea = document.getElementById('id-card-render-area');
        renderArea.innerHTML = this.generateIDCardHTML(config);
    }

    generateIDCardHTML(config) {
        const { 
            layout, schoolName, address, phone, primaryColor, logoUrl,
            studentName, studentId, studentClass, bloodGroup, emergencyContact,
            photoUrl, qrCodeData
        } = config;
        
        const style = `--card-primary: ${primaryColor};`;
        const qrImage = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrCodeData)}" style="width: 100%; height: 100%;">`;

        if (layout === 'vertical') {
            return `
                <div class="id-card vertical" style="${style}">
                    <div class="card-accent"></div>
                    <div class="card-header">
                        <div class="logo-area"><img src="${logoUrl}" alt="Logo"></div>
                        <div class="school-name">${schoolName}</div>
                        <div class="school-info">${address} • ${phone}</div>
                    </div>
                    <div class="card-body">
                        <div class="photo-frame"><img src="${photoUrl}" width="100%" height="100%" style="object-fit:cover;"></div>
                        <div class="student-name">${studentName}</div>
                        <div class="student-id">ID: ${studentId}</div>
                        <div class="details-grid">
                            <div class="detail-item"><label>Class</label><span>${studentClass}</span></div>
                            <div class="detail-item"><label>Blood</label><span>${bloodGroup}</span></div>
                            <div class="detail-item"><label>Emergency</label><span>${emergencyContact}</span></div>
                        </div>
                        <div class="qr-area">${qrImage}</div>
                    </div>
                </div>`;
        }

        if (layout === 'horizontal') {
            return `
                <div class="id-card horizontal" style="${style}">
                    <div class="side-stripe"></div>
                    <div class="card-main">
                        <div style="flex:1; display:flex; flex-direction:column;">
                            <div class="logo-area" style="justify-content:flex-start;"><img src="${logoUrl}"></div>
                            <div class="school-name" style="font-size:12px;">${schoolName}</div>
                            <div class="school-info" style="font-size:8px;">${address}</div>
                            <div class="student-name" style="margin-top:1rem; font-size:22px;">${studentName}</div>
                            <div class="student-id" style="width:fit-content;">ID: ${studentId}</div>
                            <div class="details-grid" style="border:none; padding:0;">
                                <div class="detail-item"><label>Class</label><span>${studentClass}</span></div>
                                <div class="detail-item"><label>Emergency</label><span>${emergencyContact}</span></div>
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; align-items:center;">
                            <div class="photo-frame"><img src="${photoUrl}" width="100%" height="100%" style="object-fit:cover;"></div>
                            <div class="qr-area" style="padding:0; border:none; width: 60px; height: 60px;">${qrImage}</div>
                        </div>
                    </div>
                </div>`;
        }

        if (layout === 'minimal') {
            return `
                <div class="id-card minimal" style="${style}">
                    <div class="card-body">
                        <div class="photo-frame" style="width:120px; height:120px; border-radius:50%;"><img src="${photoUrl}" width="100%" height="100%" style="object-fit:cover;"></div>
                        <div class="student-name">${schoolName}</div>
                        <div class="student-id">Student Record</div>
                        <h2 style="font-weight:800; margin-top:2rem;">${studentName}</h2>
                        <p style="color:#666;">${studentClass} • ${studentId}</p>
                        <div class="qr-area" style="border:none; margin-top:3rem; padding:0; width: 80px; height: 80px;">${qrImage}</div>
                    </div>
                </div>`;
        }

        if (layout === 'detailed') {
            return `
                <div class="id-card detailed" style="${style}">
                    <div class="card-header">
                        <div class="school-name">${schoolName}</div>
                        <div class="school-info">${address}</div>
                    </div>
                    <div class="card-body">
                        <div class="photo-frame" style="width:80px; height:80px; margin:0.5rem 0;"><img src="${photoUrl}" width="100%" height="100%" style="object-fit:cover;"></div>
                        <div class="student-name" style="font-size:16px;">${studentName}</div>
                        <div class="details-grid">
                            <div class="detail-item"><label>ID</label><span>${studentId}</span></div>
                            <div class="detail-item"><label>Class</label><span>${studentClass}</span></div>
                            <div class="detail-item"><label>Blood</label><span>${bloodGroup}</span></div>
                            <div class="detail-item"><label>Emergency</label><span>${emergencyContact}</span></div>
                        </div>
                        <div class="id-config-footer" style="padding:10px; width:100%; text-align:center; background:#eee; font-size:8px; margin-top:auto;">
                            Authorized by ${schoolName}
                        </div>
                    </div>
                </div>`;
        }

        if (layout === 'fauget') {
            return `
                <div class="id-card fauget">
                    <div class="fauget-header">
                        <div class="fauget-logo-wrap">
                            <img src="${logoUrl}" width="100%">
                        </div>
                        <div class="fauget-school-meta">
                            <div class="fauget-school-name">${schoolName}</div>
                            <div class="fauget-school-sub">${address}</div>
                            <div class="fauget-school-sub">Contact: ${phone}</div>
                        </div>
                    </div>
                    <div class="fauget-photo-frame">
                        <img src="${photoUrl}" alt="Student">
                    </div>
                    <div class="fauget-student-name">${studentName}</div>
                    <div class="fauget-details">
                        <div class="fauget-row">
                            <span class="fauget-label">Class:</span>
                            <span class="fauget-value">${studentClass}</span>
                        </div>
                        <div class="fauget-row">
                            <span class="fauget-label">Blood group:</span>
                            <span class="fauget-value">${bloodGroup}</span>
                        </div>
                        <div class="fauget-row">
                            <span class="fauget-label">Emergency contact:</span>
                            <span class="fauget-value">${emergencyContact}</span>
                        </div>
                    </div>
                    <div class="fauget-qr-area">
                        ${qrImage}
                    </div>
                </div>`;
        }
    }

    async saveIDTemplateCustomization() {
        if (!this.currentUser || !this.currentUser.school_id) return;

        const config = {
            id_card_template: this.currentIDLayout,
            id_card_name: document.getElementById('id-config-name').value,
            id_card_address: document.getElementById('id-config-address').value,
            id_card_phone: document.getElementById('id-config-phone').value,
            id_card_primary_color: document.getElementById('id-config-color').value,
            id_card_logo: document.getElementById('id-config-logo').value
        };

        try {
            const school = this.schools.find(s => s.id === this.currentUser.school_id);
            if (school && school.firebase_id) {
                await window.db.collection('schools').doc(school.firebase_id).update(config);
                this.showToast("ID Card Design Saved Successfully!", "success");
                this.setRole('admin');
            }
        } catch (e) {
            console.error(e);
            this.showToast("Failed to save design.", "error");
        }
    }

    resetIDDesign() {
        if (confirm("Reset current design customizations?")) {
            this.showIDTemplates();
        }
    }

    // --- GENERATE STUDENT ID CARD ENGINE ---
    
    showGenerateIDCard() {
        if (!this.currentUser || !this.currentUser.school_id) {
            this.showToast("School ID not found", "error");
            return;
        }

        const school = this.schools.find(s => s.id === this.currentUser.school_id);
        this.currentGenerateIDLayout = school.id_card_template || 'vertical';
        
        this.selectedBaseConfig = {
            schoolName: school.id_card_name || school.name || '',
            address: school.id_card_address || school.address || '',
            phone: school.id_card_phone || school.contact_phone || '',
            primaryColor: school.id_card_primary_color || '#3b82f6',
            logoUrl: school.id_card_logo || 'https://ui-avatars.com/api/?name=S&background=random'
        };
        this.selectedGenerateStudent = null;

        this.renderGenerateIDStudentList();
        
        document.querySelectorAll('#tab-generate-id .mini-option').forEach(opt => opt.classList.remove('selected'));
        const activeOpt = document.getElementById(`gen-opt-${this.currentGenerateIDLayout}`);
        if(activeOpt) activeOpt.classList.add('selected');

        this.updateGenerateIDPreview();
    }

    renderGenerateIDStudentList() {
        const searchInput = document.getElementById('gen-student-search');
        const query = (searchInput ? searchInput.value : '').toLowerCase();
        const listContainer = document.getElementById('gen-student-list');
        if (!listContainer) return;
        
        let schoolStudents = this.students.filter(s => s.school_id === this.currentUser.school_id);
        if (query) {
            schoolStudents = schoolStudents.filter(s => 
                (s.name && s.name.toLowerCase().includes(query)) || 
                (s.class && s.class.toLowerCase().includes(query))
            );
        }

        if (schoolStudents.length === 0) {
            listContainer.innerHTML = `<div class="p-3 text-muted text-center"><small>No students found matching your search</small></div>`;
            return;
        }

        listContainer.innerHTML = schoolStudents.map(s => {
            const isActive = this.selectedGenerateStudent && this.selectedGenerateStudent.id === s.id;
            return `
                <div class="user-list-item" 
                     onclick="app.selectStudentForID('${s.id}')" 
                     style="display: flex; gap: 10px; align-items: center; padding: 10px; border-bottom: 1px solid var(--border-light); cursor: pointer; background: ${isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent'};">
                    <img src="${s.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=random`}" 
                         style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover;">
                    <div style="flex: 1;">
                        <div style="font-size: 13px; font-weight: 600; color: var(--text-main);">${s.name}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">Class: ${s.class || 'N/A'}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    selectStudentForID(studentId) {
        this.selectedGenerateStudent = this.students.find(s => s.id === studentId);
        this.renderGenerateIDStudentList(); // Show active state
        this.updateGenerateIDPreview();
    }

    previewGenerateTemplate(layout) {
        this.currentGenerateIDLayout = layout;
        document.querySelectorAll('.mini-option').forEach(opt => opt.classList.remove('selected'));
        const activeOpt = document.getElementById(`gen-opt-${layout}`);
        if(activeOpt) activeOpt.classList.add('selected');
        this.updateGenerateIDPreview();
    }

    updateGenerateIDPreview() {
        const renderArea = document.getElementById('generate-id-render-area');
        
        if (!this.selectedGenerateStudent) {
            renderArea.innerHTML = `<div style="text-align:center; color: var(--text-muted); padding: 50px;">Please select a student from the list to preview their ID card.</div>`;
            return;
        }

        const student = this.selectedGenerateStudent;
        
        const config = {
            ...this.selectedBaseConfig,
            layout: this.currentGenerateIDLayout,
            studentName: student.name || 'Unknown User',
            studentId: student.student_id || student.id || 'SG-001',
            studentClass: student.class || 'N/A',
            bloodGroup: student.bloodGroup || 'N/A',
            emergencyContact: student.parent_phone || 'N/A',
            photoUrl: student.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name)}&background=ddd&color=333`,
            qrCodeData: student.student_id ? student.student_id : 'SG-001'
        };

        renderArea.innerHTML = this.generateIDCardHTML(config);
    }

    downloadGeneratedID(format) {
        if (format === 'png') {
            this.downloadIDCardImage();
        } else if (format === 'pdf') {
            this.downloadIDCardPDF();
        }
    }

    async downloadIDCardImage() {
        if (!this.selectedGenerateStudent) {
            this.showToast("Please select a student first", "warning");
            return;
        }
        
        this.showToast("Generating Image...", "info");
        const renderCell = document.querySelector('#generate-id-render-area .id-card');
        
        try {
            const canvas = await html2canvas(renderCell, {
                scale: 3, // High resolution
                useCORS: true,
                backgroundColor: null, // Transparent if needed
                logging: false
            });
            
            const link = document.createElement('a');
            link.download = `ID_Card_${this.selectedGenerateStudent.name.replace(/ /g, '_')}_${this.selectedGenerateStudent.class || 'Class'}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            this.showToast("Download Complete", "success");
        } catch (e) {
            console.error("Image generation failed", e);
            this.showToast("Failed to generate image. Please check console.", "error");
        }
    }

    async downloadIDCardPDF() {
        if (!this.selectedGenerateStudent) {
            this.showToast("Please select a student first", "warning");
            return;
        }
        
        if (typeof window.html2pdf !== 'function') {
            this.showToast("PDF Library not loaded", "error");
            return;
        }

        this.showToast("Generating PDF Document...", "info");
        const element = document.querySelector('#generate-id-render-area .id-card');
        
        const opt = {
            margin:       0.5,
            filename:     `ID_Card_${this.selectedGenerateStudent.name.replace(/ /g, '_')}.pdf`,
            image:        { type: 'jpeg', quality: 1 },
            html2canvas:  { scale: 4, useCORS: true },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };
        
        // Let it run in background slightly so UI doesn't freeze harshly
        setTimeout(() => {
            window.html2pdf().set(opt).from(element).save().then(() => {
                this.showToast("Template Downloaded as PDF", "success");
            }).catch(e => {
                this.showToast("Failed to generate PDF", "error");
            });
        }, 100);
    }

    async saveGeneratedIDCard() {
         if (!this.selectedGenerateStudent) {
            this.showToast("Please select a student first", "warning");
            return;
        }
        
        // This is a mockup for saving metadata to a specific collection 
        // useful if you want to keep logs of how many cards printed
        try {
            await window.db.collection('id_card_logs').add({
                school_id: this.currentUser.school_id,
                student_id: this.selectedGenerateStudent.id,
                template_used: this.currentGenerateIDLayout,
                generated_by: this.currentUser.id,
                generated_at: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.showToast("ID Generation Logged in System", "success");
        } catch (e) {
            // Fails silently for user, not critical.
            console.error(e);
            this.showToast("Check your internet connection.", "warning");
        }
    }
    // --- NOTIFICATIONS MODULE ---

    switchNotificationTab(tab) {
        document.querySelectorAll('.notification-tab-content').forEach(el => el.style.display = 'none');
        document.getElementById(`tab-${tab}`).style.display = 'block';
        
        ['create-notification', 'drafts', 'sent'].forEach(t => {
            const btn = document.getElementById(`btn-tab-${t}`);
            if (btn) {
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-tertiary');
            }
        });
        const activeBtn = document.getElementById(`btn-tab-${tab === 'create' ? 'create-notification' : tab}`);
        if(activeBtn) {
            activeBtn.classList.remove('btn-tertiary');
            activeBtn.classList.add('btn-primary');
        }

        if(tab !== 'create') {
            this.renderNotificationsTables();
        }
    }

    handleNotificationTypeChange() {
        const typeEl = document.getElementById('notif-type');
        const customContainer = document.getElementById('notif-custom-type-container');
        if (typeEl && customContainer) {
            if (typeEl.value === 'Other') {
                customContainer.style.display = 'block';
            } else {
                customContainer.style.display = 'none';
            }
        }
    }

    handleNotificationTargetChange() {
        const targetTypeEl = document.querySelector('input[name="notif-target-type"]:checked');
        if (!targetTypeEl) return;
        const targetType = targetTypeEl.value;
        const container = document.getElementById('notif-target-selection-container');
        if (!container) return;

        let schoolStudents = this.students.filter(s => s.school_id === this.currentUser.school_id);
        
        if (targetType === 'individual') {
            container.innerHTML = `
                <label class="text-muted" style="font-size:0.85rem; display:block; margin-bottom: 0.3rem;">Select Student</label>
                <select id="notif-target-data" class="custom-select w-100">
                    <option value="">-- Select a Student --</option>
                    ${schoolStudents.map(s => `<option value="${s.id}">${s.name} (${s.class})</option>`).join('')}
                </select>
            `;
        } else if (targetType === 'class') {
            let classes = this.classes.filter(c => c.schoolId === this.currentUser.school_id && c.status === 'active').map(c => c.displayName);
            // Fallback to existing student classes if none created yet
            if (classes.length === 0) {
                classes = [...new Set(schoolStudents.map(s => s.class))].filter(Boolean).sort();
            } else {
                classes.sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
            }
            container.innerHTML = `
                <label class="text-muted" style="font-size:0.85rem; display:block; margin-bottom: 0.3rem;">Select Class</label>
                <select id="notif-target-data" class="custom-select w-100">
                    <option value="">-- Select a Class --</option>
                    ${classes.map(c => `<option value="${c}">Class ${c}</option>`).join('')}
                </select>
            `;
        } else if (targetType === 'multiple') {
            container.innerHTML = `
                <label class="text-muted" style="font-size:0.85rem; display:block; margin-bottom: 0.5rem;">Select Students</label>
                <div style="max-height: 200px; overflow-y: auto; padding-right: 0.5rem;">
                    ${schoolStudents.map(s => `
                        <div style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                            <input type="checkbox" name="notif-multi-student" value="${s.id}" id="chk_notif_${s.id}">
                            <label for="chk_notif_${s.id}" class="text-muted" style="font-size:0.85rem; margin:0;">${s.name} (${s.class})</label>
                        </div>
                    `).join('')}
                </div>
            `;
        }
    }

    getNotificationFormData() {
        const docId = document.getElementById('notif-doc-id').value;
        const type = document.getElementById('notif-type').value;
        const customType = document.getElementById('notif-custom-type').value;
        const targetType = document.querySelector('input[name="notif-target-type"]:checked').value;
        const title = document.getElementById('notif-title').value.trim();
        const message = document.getElementById('notif-message').value.trim();
        
        let targetIds = [];
        if (targetType === 'multiple') {
            const checkboxes = document.querySelectorAll('input[name="notif-multi-student"]:checked');
            targetIds = Array.from(checkboxes).map(c => c.value);
        } else {
            const dataEl = document.getElementById('notif-target-data');
            if(dataEl && dataEl.value) {
                targetIds = [dataEl.value];
            }
        }

        if (!title || !message) {
            this.showToast("Title and message are required", "warning");
            return null;
        }

        if (targetIds.length === 0) {
            this.showToast("Please select at least one target", "warning");
            return null;
        }

        return {
            docId,
            schoolId: this.currentUser.school_id,
            type,
            customType: type === 'Other' ? customType : '',
            targetType,
            targetIds,
            title,
            message,
            createdBy: this.currentUser.uid || this.currentUser.phone_number
        };
    }

    async saveNotificationDraft() {
        const data = this.getNotificationFormData();
        if(!data) return;
        
        const payload = { ...data, status: 'draft', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
        delete payload.docId;

        try {
            if (data.docId) {
                await window.db.collection('notifications').doc(data.docId).update({ ...payload, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                this.showToast('Draft updated', 'success');
            } else {
                await window.db.collection('notifications').add(payload);
                this.showToast('Draft saved', 'success');
            }
            document.getElementById('notification-form').reset();
            document.getElementById('notif-doc-id').value = '';
            this.handleNotificationTypeChange();
            this.handleNotificationTargetChange();
            this.switchNotificationTab('drafts');
        } catch (e) {
            this.showToast('Error saving draft', 'error');
            console.error(e);
        }
    }

    async sendNotificationFromData(data) {
        if(!data) return;
        
        const payload = { ...data, status: 'sent', sentAt: firebase.firestore.FieldValue.serverTimestamp() };
        if(!payload.createdAt) {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        }
        delete payload.docId;

        // Resolve target parents
        let targetParents = [];
        if (payload.targetType === 'class') {
            const targetedStudents = this.students.filter(s => payload.targetIds.includes(s.class));
            const targetedStudentIds = targetedStudents.map(s => s.id);
            targetParents = this.users.filter(u => u.role === 'parent' && targetedStudentIds.includes(u.linked_student_id));
        } else {
            targetParents = this.users.filter(u => u.role === 'parent' && payload.targetIds.includes(u.linked_student_id));
        }

        try {
            let notifRef;
            if (data.docId) {
                notifRef = window.db.collection('notifications').doc(data.docId);
                await notifRef.update(payload);
            } else {
                notifRef = await window.db.collection('notifications').add(payload);
            }

            const notifId = data.docId || notifRef.id;
            const batch = window.db.batch();
            targetParents.forEach(parent => {
                const receiptRef = window.db.collection('notification_receipts').doc();
                batch.set(receiptRef, {
                    notificationId: notifId,
                    parentId: parent.id || parent.phone_number,
                    isRead: false,
                    readAt: null
                });
            });
            await batch.commit();
            this.showToast('Notification Sent Successfully!', 'success');
            const form = document.getElementById('notification-form');
            if(form) {
                form.reset();
                document.getElementById('notif-doc-id').value = '';
                this.handleNotificationTypeChange();
                this.handleNotificationTargetChange();
            }
            this.switchNotificationTab('sent');
        } catch (e) {
            this.showToast('Error sending notification', 'error');
            console.error(e);
        }
    }

    async sendNotification() {
        const data = this.getNotificationFormData();
        await this.sendNotificationFromData(data);
    }

    async sendNotificationDraft(id) {
        const notif = this.notifications.find(n => n.id === id);
        if(!notif) return;
        notif.docId = id;
        await this.sendNotificationFromData(notif);
    }

    editNotification(id) {
        const notif = this.notifications.find(n => n.id === id);
        if(!notif) return;
        
        document.getElementById('notif-doc-id').value = notif.id;
        document.getElementById('notif-type').value = notif.type;
        document.getElementById('notif-custom-type').value = notif.customType || '';
        document.getElementById('notif-title').value = notif.title;
        document.getElementById('notif-message').value = notif.message;
        
        const radio = document.querySelector(`input[name="notif-target-type"][value="${notif.targetType}"]`);
        if (radio) radio.checked = true;
        
        this.handleNotificationTypeChange();
        this.handleNotificationTargetChange();

        setTimeout(() => {
            if (notif.targetType === 'multiple') {
                notif.targetIds.forEach(tId => {
                    const chk = document.getElementById(`chk_notif_${tId}`);
                    if(chk) chk.checked = true;
                });
            } else {
                const dataEl = document.getElementById('notif-target-data');
                if(dataEl && notif.targetIds.length > 0) {
                    dataEl.value = notif.targetIds[0];
                }
            }
        }, 100);

        this.switchNotificationTab('create');
    }

    async deleteNotification(id) {
        if(confirm("Are you sure you want to delete this notification?")) {
            await window.db.collection('notifications').doc(id).delete();
            this.showToast("Deleted successfully", "info");
        }
    }

    renderNotificationsTables() {
        const draftsTbody = document.getElementById('notif-drafts-table-body');
        const sentTbody = document.getElementById('notif-sent-table-body');
        if(!draftsTbody || !sentTbody) return;

        const schoolNotifs = this.notifications.filter(n => n.schoolId === this.currentUser.school_id);
        const drafts = schoolNotifs.filter(n => n.status === 'draft');
        const sent = schoolNotifs.filter(n => n.status === 'sent');

        const formatTarget = (n) => {
            if(n.targetType === 'class') return `Class: ${n.targetIds.join(', ')}`;
            if(n.targetType === 'individual') return 'Individual Student';
            return `${n.targetIds.length} Students`;
        };

        const formatDate = (timestamp) => {
            if(!timestamp) return 'N/A';
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleString();
        };

        draftsTbody.innerHTML = drafts.length ? drafts.map(n => `
            <tr>
                <td><strong>${n.title}</strong></td>
                <td><span class="badge" style="background:var(--bg-hover); color:var(--text-color);">${n.type === 'Other' ? n.customType : n.type}</span></td>
                <td>${formatTarget(n)}</td>
                <td>${formatDate(n.updatedAt || n.createdAt)}</td>
                <td style="text-align: right;">
                    <button class="icon-btn" onclick="app.editNotification('${n.id}')" title="Edit"><i class="fa-solid fa-pen text-blue"></i></button>
                    <button class="icon-btn" onclick="app.sendNotificationDraft('${n.id}')" title="Send"><i class="fa-solid fa-paper-plane text-green"></i></button>
                    <button class="icon-btn" onclick="app.deleteNotification('${n.id}')" title="Delete"><i class="fa-solid fa-trash text-danger"></i></button>
                </td>
            </tr>
        `).join('') : `<tr><td colspan="5" class="text-center text-muted">No drafts found.</td></tr>`;

        sentTbody.innerHTML = sent.length ? sent.map(n => `
            <tr>
                <td><strong>${n.title}</strong></td>
                <td><span class="badge" style="background:var(--bg-hover); color:var(--text-color);">${n.type === 'Other' ? n.customType : n.type}</span></td>
                <td>${formatTarget(n)}</td>
                <td>${formatDate(n.sentAt)}</td>
                <td><span class="badge" style="background:rgba(46, 213, 115, 0.2); color:var(--success);">Sent</span></td>
            </tr>
        `).join('') : `<tr><td colspan="5" class="text-center text-muted">No sent notifications found.</td></tr>`;
    }

    // --- PARENT NOTIFICATIONS MODAL ---

    openParentNotifications() {
        const modal = document.getElementById('parent-notifications-modal');
        if(modal) {
            modal.classList.add('show');
            this.renderParentNotifications();
        }
    }

    closeParentNotifications() {
        const modal = document.getElementById('parent-notifications-modal');
        if(modal) modal.classList.remove('show');
    }

    renderParentNotifications() {
        const badge = document.getElementById('parent-notif-badge');
        const list = document.getElementById('parent-notif-list');
        if(!badge || !list) return;

        const parentId = this.currentUser.id || this.currentUser.phone_number;
        const myReceipts = this.notificationReceipts.filter(r => r.parentId === parentId);
        
        const unreadCount = myReceipts.filter(r => !r.isRead).length;
        if(unreadCount > 0) {
            badge.style.display = 'block';
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        } else {
            badge.style.display = 'none';
        }

        // Map receipts to actual notifications
        let notifsToRender = myReceipts.map(r => {
            const notif = this.notifications.find(n => n.id === r.notificationId);
            return notif ? { ...notif, receipt: r } : null;
        }).filter(n => n !== null);

        notifsToRender.sort((a, b) => {
            const dateA = a.sentAt ? a.sentAt.toMillis() : 0;
            const dateB = b.sentAt ? b.sentAt.toMillis() : 0;
            return dateB - dateA;
        });

        if(notifsToRender.length === 0) {
            list.innerHTML = `<div class="text-center text-muted" style="padding: 2rem;">No notifications yet.</div>`;
            return;
        }

        list.innerHTML = notifsToRender.map(n => {
            const isUnread = !n.receipt.isRead;
            const date = n.sentAt ? n.sentAt.toDate().toLocaleString() : '';
            const typeLabel = n.type === 'Other' ? n.customType : n.type;
            
            return `
                <div class="glass-panel" style="padding: 1rem; cursor: pointer; border-left: 4px solid ${isUnread ? 'var(--primary)' : 'transparent'}; transition: 0.2s;" onclick="app.openNotifDetail('${n.id}', '${n.receipt.id}')">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: ${isUnread ? 'var(--text-color)' : 'var(--text-muted)'};">${n.title}</h4>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">${date}</span>
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <span class="badge" style="background:var(--bg-hover); color:var(--text-color);">${typeLabel}</span>
                    </div>
                    <div style="font-size: 0.85rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${n.message}
                    </div>
                </div>
            `;
        }).join('');
    }

    async openNotifDetail(notifId, receiptId) {
        const notif = this.notifications.find(n => n.id === notifId);
        if(!notif) return;

        // Mark as read in Firebase
        const receipt = this.notificationReceipts.find(r => r.id === receiptId);
        if (receipt && !receipt.isRead) {
            try {
                await window.db.collection('notification_receipts').doc(receiptId).update({
                    isRead: true,
                    readAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (e) {
                console.error("Error marking read:", e);
            }
        }

        const titleEl = document.getElementById('notif-detail-title');
        const badgeEl = document.getElementById('notif-detail-badge');
        const dateEl = document.getElementById('notif-detail-date');
        const msgEl = document.getElementById('notif-detail-message');

        if(titleEl) titleEl.textContent = notif.title;
        if(badgeEl) {
            badgeEl.textContent = notif.type === 'Other' ? notif.customType : notif.type;
            badgeEl.style.background = 'var(--bg-hover)';
            badgeEl.style.color = 'var(--text-color)';
        }
        if(dateEl) dateEl.textContent = notif.sentAt ? notif.sentAt.toDate().toLocaleString() : '';
        if(msgEl) msgEl.textContent = notif.message;

        const modal = document.getElementById('notif-detail-modal');
        if(modal) modal.classList.add('show');
    }

    closeNotifDetail() {
        const modal = document.getElementById('notif-detail-modal');
        if(modal) modal.classList.remove('show');
    }

    // --- CLASS MANAGEMENT MODULE ---

    renderClasses() {
        const tbody = document.getElementById('class-list-body');
        if (!tbody) return;

        const search = (document.getElementById('class-search') ? document.getElementById('class-search').value.toLowerCase() : '');
        const statusFilter = (document.getElementById('class-status-filter') ? document.getElementById('class-status-filter').value : 'all');

        const schoolClasses = this.classes.filter(c => c.schoolId === this.currentUser.school_id);
        
        let filtered = schoolClasses.filter(c => {
            const matchesSearch = c.displayName.toLowerCase().includes(search) || c.name.toLowerCase().includes(search) || c.section.toLowerCase().includes(search);
            const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
            return matchesSearch && matchesStatus;
        });

        // Sort by name then section
        filtered.sort((a, b) => {
            if(a.name === b.name) {
                return a.section.localeCompare(b.section);
            }
            return a.name.localeCompare(b.name, undefined, {numeric: true});
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No classes found.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(c => {
            let teacherName = 'Unassigned';
            if (c.classTeacherId) {
                const teacher = this.users.find(u => (u.id === c.classTeacherId || u.phone_number === c.classTeacherId) && u.role === 'teacher');
                if (teacher) teacherName = teacher.name;
            }
            const statusBadge = c.status === 'active' 
                ? `<span class="badge" style="background:rgba(46, 213, 115, 0.2); color:var(--success);">Active</span>`
                : `<span class="badge" style="background:rgba(255, 71, 87, 0.2); color:var(--danger);">Inactive</span>`;
            
            const subjects = (c.subjects && Array.isArray(c.subjects)) ? c.subjects.join(', ') : 'None';

            return `
                <tr>
                    <td><strong>${c.displayName}</strong></td>
                    <td>${teacherName}</td>
                    <td><span class="text-muted" style="font-size: 0.85rem;">${subjects}</span></td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right;">
                        <button class="icon-btn" onclick="app.editClass('${c.id}')" title="Edit"><i class="fa-solid fa-pen text-blue"></i></button>
                        <button class="icon-btn" onclick="app.deleteClass('${c.id}')" title="${c.status === 'active' ? 'Deactivate' : 'Delete'}"><i class="fa-solid fa-trash text-danger"></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    openClassModal() {
        const form = document.getElementById('class-form');
        if(form) form.reset();
        
        const docIdEl = document.getElementById('class-doc-id');
        if(docIdEl) docIdEl.value = '';
        
        const titleEl = document.getElementById('class-modal-title');
        if(titleEl) titleEl.textContent = 'Add New Class';
        
        // Populate Teachers
        const teacherSelect = document.getElementById('class-teacher');
        if(teacherSelect) {
            const teachers = this.users.filter(u => u.role === 'teacher' && u.school_id === this.currentUser.school_id);
            
            if (teachers.length === 0) {
                teacherSelect.innerHTML = `<option value="">No teachers available</option>`;
            } else {
                teacherSelect.innerHTML = `<option value="">-- Select Class Teacher --</option>` + 
                    teachers.map(t => `<option value="${t.id || t.phone_number}">${t.name} (${t.phone_number})</option>`).join('');
            }
        }

        const modal = document.getElementById('manage-class-modal');
        if (modal) modal.classList.add('show');
    }

    closeClassModal() {
        const modal = document.getElementById('manage-class-modal');
        if (modal) modal.classList.remove('show');
    }

    async saveClass(event) {
        event.preventDefault();
        
        const docId = document.getElementById('class-doc-id').value;
        const name = document.getElementById('class-name').value.trim();
        const section = document.getElementById('class-section').value.trim();
        const teacherId = document.getElementById('class-teacher').value;
        const subjectsInput = document.getElementById('class-subjects').value.trim();
        
        const displayName = `${name}${section}`;
        const subjects = subjectsInput ? subjectsInput.split(',').map(s => s.trim()).filter(Boolean) : [];

        // Validation for duplicates
        const existingClass = this.classes.find(c => 
            c.schoolId === this.currentUser.school_id && 
            c.displayName.toLowerCase() === displayName.toLowerCase() && 
            c.id !== docId
        );

        if (existingClass) {
            this.showToast(`Class ${displayName} already exists!`, 'warning');
            return;
        }

        // Validation for class teacher (only one per class if necessary, but DB can be flexible)
        if (teacherId) {
            const existingTeacherClass = this.classes.find(c =>
                c.schoolId === this.currentUser.school_id &&
                c.classTeacherId === teacherId &&
                c.id !== docId &&
                c.status === 'active'
            );
            if (existingTeacherClass) {
                this.showToast(`Teacher is already assigned to ${existingTeacherClass.displayName}`, 'warning');
                return;
            }
        }

        const payload = {
            name,
            section,
            displayName,
            classTeacherId: teacherId || null,
            subjects,
            schoolId: this.currentUser.school_id,
            status: 'active'
        };

        try {
            if (docId) {
                payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
                await window.db.collection('classes').doc(docId).update(payload);
                this.showToast('Class updated successfully', 'success');
            } else {
                payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await window.db.collection('classes').add(payload);
                this.showToast('Class created successfully', 'success');
            }
            this.closeClassModal();
        } catch (e) {
            console.error("Error saving class:", e);
            this.showToast('Error saving class', 'error');
        }
    }

    editClass(id) {
        this.openClassModal(); // prepopulates teachers
        const c = this.classes.find(cls => cls.id === id);
        if (!c) return;

        document.getElementById('class-doc-id').value = c.id;
        document.getElementById('class-modal-title').textContent = `Edit Class: ${c.displayName}`;
        document.getElementById('class-name').value = c.name;
        document.getElementById('class-section').value = c.section;
        
        if (c.classTeacherId) {
            document.getElementById('class-teacher').value = c.classTeacherId;
        }
        
        if (c.subjects && Array.isArray(c.subjects)) {
            document.getElementById('class-subjects').value = c.subjects.join(', ');
        }
    }

    async deleteClass(id) {
        const c = this.classes.find(cls => cls.id === id);
        if(!c) return;
        
        if (c.status === 'active') {
            if(confirm(`Are you sure you want to deactivate Class ${c.displayName}?`)) {
                await window.db.collection('classes').doc(id).update({ status: 'inactive' });
                this.showToast(`Class ${c.displayName} deactivated`, 'info');
            }
        } else {
            if(confirm(`Are you sure you want to permanently delete Class ${c.displayName}?`)) {
                await window.db.collection('classes').doc(id).delete();
                this.showToast(`Class ${c.displayName} deleted`, 'info');
            }
        }
    }
}

// Initialize on load
const app = new SafeGate();
