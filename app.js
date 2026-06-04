// Configurations
const STORAGE_KEY_ROOMS = 'school_rooms_v3';
const STORAGE_KEY_BOOKINGS = 'school_bookings_v3';

// [설정] 관리자 패널(톱니바퀴) 진입 비밀번호입니다. 원하는 비밀번호로 변경하여 사용하세요.
const ADMIN_PASSWORD = 'admin';

const PRESET_COLORS = [
    { name: 'Blue', color: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)', glow: 'var(--primary-glow)' },
    { name: 'Teal', color: 'linear-gradient(135deg, #11e8b7 0%, #0099f7 100%)', glow: 'rgba(17, 232, 183, 0.3)' },
    { name: 'Purple', color: 'linear-gradient(135deg, #f355da 0%, #7006ff 100%)', glow: 'var(--accent-glow)' },
    { name: 'Orange', color: 'linear-gradient(135deg, #ff9966 0%, #ff5e62 100%)', glow: 'rgba(255, 94, 98, 0.3)' }
];

const PRESET_ICONS = [
    'beaker', 'monitor', 'palette', 'music', 
    'book-open', 'trophy', 'cpu', 'award', 
    'clapperboard', 'shapes', 'map', 'globe'
];

// Application States
let rooms = [];
let bookings = {};
let selectedRoom = null;
let viewMode = 'week'; // 'week' | 'month'
let referenceDate = new Date(); // The date used to calculate the active week/month view
let activePeriod = null;
let activeTargetDate = null; // Used for booking dialog (YYYY-MM-DD)

// Admin form selections
let selectedAdminIcon = PRESET_ICONS[0];
let selectedAdminColor = PRESET_COLORS[0];

// Safe environment variable fetcher (SyntaxError safe on plain browsers)
const getEnv = (key) => {
    try {
        // Safe runtime evaluation of import.meta to avoid syntax crashes in normal browsers
        const metaEnv = new Function("try { return import.meta.env; } catch(e) { return null; }")();
        if (metaEnv && metaEnv[key]) {
            return metaEnv[key];
        }
    } catch (e) {}
    return window[key] || '';
};

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY') || '';

let supabase = null;
let isOnlineMode = false;

// Initialize Supabase Client if credentials are provided
if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== 'your_supabase_project_url') {
    try {
        if (window.supabase && window.supabase.createClient) {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            isOnlineMode = true;
            console.log('Supabase 실시간 클라우드 DB 연결 성공. 온라인 모드 작동 중.');
        } else {
            console.warn('Supabase SDK 라이브러리가 존재하지 않습니다.');
        }
    } catch (e) {
        console.error('Supabase 연결 초기화 실패. 로컬 폴백 모드로 구동합니다.', e);
    }
}

// DOM Elements
const roomTabs = document.getElementById('room-tabs');
const currentRangeDisplay = document.getElementById('current-range-display');
const btnPrev = document.getElementById('btn-prev');
const btnToday = document.getElementById('btn-today');
const btnNext = document.getElementById('btn-next');
const toggleWeek = document.getElementById('toggle-week');
const toggleMonth = document.getElementById('toggle-month');
const weekView = document.getElementById('week-view');
const monthView = document.getElementById('month-view');
const weekTableHeaderBody = document.querySelectorAll('#week-table-header th .date-lbl');
const weekTableBody = document.getElementById('week-table-body');
const monthCalendarGrid = document.getElementById('month-calendar-grid');

const adminToggle = document.getElementById('admin-toggle');
const adminPanel = document.getElementById('admin-panel');
const closeAdmin = document.getElementById('close-admin');
const adminRoomList = document.getElementById('admin-room-list');
const addRoomForm = document.getElementById('add-room-form');
const newRoomNameInput = document.getElementById('new-room-name');
const iconSelector = document.getElementById('icon-selector');
const colorSelector = document.getElementById('color-selector');

// Modals
const bookingModal = document.getElementById('booking-modal');
const bookingForm = document.getElementById('booking-form');
const closeModalBtn = document.getElementById('close-modal');
const closeModalXBtn = document.getElementById('close-modal-x');
const detailModal = document.getElementById('detail-modal');
const closeDetailBtn = document.getElementById('close-detail');
const closeDetailXBtn = document.getElementById('close-detail-x');
const cancelBookingBtn = document.getElementById('cancel-booking-btn');

// Initialize application
async function init() {
    renderAdminFormSelectors();
    await loadInitialData();
    
    if (isOnlineMode && supabase) {
        setupRealtimeSubscriptions();
    }
    
    setupEventListeners();
    lucide.createIcons();
    
    showToast(isOnlineMode ? '실시간 온라인 데이터베이스와 동기화 중입니다.' : '로컬 저장소 모드로 구동 중입니다.', 'info');
}

// Data Fetching
async function loadInitialData() {
    if (isOnlineMode && supabase) {
        try {
            // Load Rooms
            const { data: dbRooms, error: roomsErr } = await supabase
                .from('rooms')
                .select('*')
                .order('created_at', { ascending: true });
                
            if (roomsErr) throw roomsErr;
            
            rooms = dbRooms;
            
            // If rooms are empty in DB, initialize with default values
            if (!rooms || rooms.length === 0) {
                await initializeDefaultOnlineRooms();
            }
            
            // Load Bookings
            const { data: dbBookings, error: bookingsErr } = await supabase
                .from('bookings')
                .select('*');
                
            if (bookingsErr) throw bookingsErr;
            
            // Map Bookings: key is `{room_id}_{booking_date}`, value: `{ [period]: { id, userName, purpose } }`
            bookings = {};
            dbBookings.forEach(b => {
                const key = `${b.room_id}_${b.booking_date}`;
                if (!bookings[key]) bookings[key] = {};
                bookings[key][b.period] = {
                    id: b.id,
                    userName: b.user_name,
                    purpose: b.purpose
                };
            });
            
        } catch (err) {
            console.error('클라우드 데이터를 가져오는 데 실패했습니다. 로컬 폴백합니다.', err);
            isOnlineMode = false;
            loadLocalData();
        }
    } else {
        loadLocalData();
    }
    
    // Set default selected room if not set
    if (rooms && rooms.length > 0 && !selectedRoom) {
        selectedRoom = rooms[0];
    }
    
    renderRoomTabs();
    renderView();
}

function loadLocalData() {
    rooms = JSON.parse(localStorage.getItem(STORAGE_KEY_ROOMS)) || [
        { id: 1, name: '컴퓨터1실', icon: 'monitor', theme_color: 'var(--gradient-blue)', theme_glow: 'var(--primary-glow)' },
        { id: 2, name: '컴퓨터2실', icon: 'monitor', theme_color: 'var(--gradient-teal)', theme_glow: 'rgba(17, 232, 183, 0.3)' },
        { id: 3, name: '디지털튜터수업요청', icon: 'award', theme_color: 'var(--gradient-purple)', theme_glow: 'var(--accent-glow)' }
    ];
    bookings = JSON.parse(localStorage.getItem(STORAGE_KEY_BOOKINGS)) || {};
}

async function initializeDefaultOnlineRooms() {
    const defaults = [
        { name: '컴퓨터1실', icon: 'monitor', theme_color: 'var(--gradient-blue)', theme_glow: 'var(--primary-glow)' },
        { name: '컴퓨터2실', icon: 'monitor', theme_color: 'var(--gradient-teal)', theme_glow: 'rgba(17, 232, 183, 0.3)' },
        { name: '디지털튜터수업요청', icon: 'award', theme_color: 'var(--gradient-purple)', theme_glow: 'var(--accent-glow)' }
    ];
    
    try {
        const { error } = await supabase.from('rooms').insert(defaults);
        if (error) throw error;
        
        // Reload rooms
        const { data: dbRooms } = await supabase
            .from('rooms')
            .select('*')
            .order('created_at', { ascending: true });
        rooms = dbRooms || [];
    } catch (e) {
        console.error('기본 특별실 온라인 생성 에러:', e);
    }
}

// Realtime Sync
function setupRealtimeSubscriptions() {
    if (!supabase) return;
    
    supabase
        .channel('db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, async () => {
            console.log('실시간 DB 업데이트: 특별실 목록');
            const { data: dbRooms } = await supabase.from('rooms').select('*').order('created_at', { ascending: true });
            if (dbRooms) {
                rooms = dbRooms;
                
                // Keep selected room reference updated
                if (selectedRoom) {
                    const matched = rooms.find(r => r.id === selectedRoom.id);
                    selectedRoom = matched || rooms[0];
                } else {
                    selectedRoom = rooms[0];
                }
                
                renderRoomTabs();
                renderView();
                if (!adminPanel.classList.contains('hidden')) {
                    renderAdminRooms();
                }
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, async () => {
            console.log('실시간 DB 업데이트: 예약 내역');
            const { data: dbBookings } = await supabase.from('bookings').select('*');
            if (dbBookings) {
                bookings = {};
                dbBookings.forEach(b => {
                    const key = `${b.room_id}_${b.booking_date}`;
                    if (!bookings[key]) bookings[key] = {};
                    bookings[key][b.period] = {
                        id: b.id,
                        userName: b.user_name,
                        purpose: b.purpose
                    };
                });
                renderView();
            }
        })
        .subscribe();
}

// Event bindings
function setupEventListeners() {
    // Navigation
    btnPrev.addEventListener('click', () => navigateDateRange(-1));
    btnNext.addEventListener('click', () => navigateDateRange(1));
    btnToday.addEventListener('click', () => {
        referenceDate = new Date();
        renderView();
    });
    
    // View Mode Toggle
    toggleWeek.addEventListener('click', () => setViewMode('week'));
    toggleMonth.addEventListener('click', () => setViewMode('month'));
    
    // Admin Toggle
    adminToggle.addEventListener('click', () => {
        const password = prompt('관리자 권한인 특별실 설정을 편집하려면 비밀번호를 입력하세요:');
        if (password === ADMIN_PASSWORD) {
            adminPanel.classList.remove('hidden');
            document.getElementById('tabs-section').classList.add('hidden');
            document.getElementById('dashboard-section').classList.add('hidden');
            renderAdminRooms();
        } else if (password !== null) {
            showToast('비밀번호가 일치하지 않습니다. 관리자 권한이 필요합니다.', 'error');
        }
    });
    closeAdmin.addEventListener('click', () => {
        adminPanel.classList.add('hidden');
        document.getElementById('tabs-section').classList.remove('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        renderRoomTabs();
        renderView();
    });
    
    // Form submits
    addRoomForm.addEventListener('submit', handleAddRoomSubmit);
    bookingForm.addEventListener('submit', handleBookingSubmit);
    
    // Close modals
    closeModalBtn.addEventListener('click', () => bookingModal.classList.add('hidden'));
    closeModalXBtn.addEventListener('click', () => bookingModal.classList.add('hidden'));
    closeDetailBtn.addEventListener('click', () => detailModal.classList.add('hidden'));
    closeDetailXBtn.addEventListener('click', () => detailModal.classList.add('hidden'));
    
    cancelBookingBtn.addEventListener('click', handleCancelBookingClick);
}

// Set View Mode
function setViewMode(mode) {
    viewMode = mode;
    if (mode === 'week') {
        toggleWeek.classList.add('active');
        toggleMonth.classList.remove('active');
        weekView.classList.remove('hidden');
        monthView.classList.add('hidden');
    } else {
        toggleWeek.classList.remove('active');
        toggleMonth.classList.add('active');
        weekView.classList.add('hidden');
        monthView.classList.remove('hidden');
    }
    renderView();
}

// Date Navigation
function navigateDateRange(direction) {
    if (viewMode === 'week') {
        // Move by 7 days
        referenceDate.setDate(referenceDate.getDate() + (direction * 7));
    } else {
        // Move by 1 month
        referenceDate.setMonth(referenceDate.getMonth() + direction);
    }
    renderView();
}

// Render Room Navigation Tabs
function renderRoomTabs() {
    roomTabs.innerHTML = '';
    rooms.forEach(room => {
        const btn = document.createElement('button');
        btn.className = 'room-tab-btn';
        if (selectedRoom && selectedRoom.id === room.id) {
            btn.className += ' active';
            // Set dynamic css properties for the glowing indicator
            btn.style.setProperty('--active-bg', room.theme_color || 'var(--gradient-blue)');
            btn.style.setProperty('--active-glow', room.theme_glow || 'var(--primary-glow)');
        }
        
        btn.innerHTML = `
            <i data-lucide="${room.icon || 'door-open'}"></i>
            <span>${room.name}</span>
        `;
        
        btn.addEventListener('click', () => {
            selectedRoom = room;
            renderRoomTabs();
            renderView();
        });
        
        roomTabs.appendChild(btn);
    });
    lucide.createIcons();
}

// Render selected view (Week vs Month)
function renderView() {
    if (!selectedRoom) return;
    
    if (viewMode === 'week') {
        renderWeekView();
    } else {
        renderMonthView();
    }
}

// Helper: Calculate week dates (Monday to Friday) of referenceDate
function getWeekDates(refDate) {
    const dates = [];
    const currentDay = refDate.getDay(); // 0 is Sunday, 1 is Monday...
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay; // Distance to Monday
    
    const monday = new Date(refDate);
    monday.setDate(refDate.getDate() + distanceToMonday);
    
    for (let i = 0; i < 5; i++) { // Monday to Friday
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        dates.push(day);
    }
    return dates;
}

// Render Week View
function renderWeekView() {
    const weekDates = getWeekDates(referenceDate);
    
    // 1. Update range display header (e.g., 2026.05.25 ~ 05.29)
    const firstDate = weekDates[0];
    const lastDate = weekDates[4];
    const rangeText = `${firstDate.getFullYear()}년 ${firstDate.getMonth() + 1}월 ${firstDate.getDate()}일 ~ ${lastDate.getMonth() + 1}월 ${lastDate.getDate()}일`;
    currentRangeDisplay.textContent = rangeText;
    
    // 2. Set date headers
    const weekDays = ['월', '화', '수', '목', '금'];
    const headerThs = document.querySelectorAll('#week-table-header th');
    weekDates.forEach((date, index) => {
        const labelSpan = headerThs[index + 1].querySelector('.date-lbl');
        if (labelSpan) {
            labelSpan.textContent = `(${date.getMonth() + 1}/${date.getDate()})`;
        }
    });
    
    // 3. Render 1~6 period rows
    weekTableBody.innerHTML = '';
    
    for (let period = 1; period <= 6; period++) {
        const tr = document.createElement('tr');
        
        // Period column
        const periodTd = document.createElement('td');
        periodTd.className = 'period-col';
        periodTd.innerHTML = `<span>${period}</span><div class="period-unit">교시</div>`;
        tr.appendChild(periodTd);
        
        // Monday to Friday cells
        weekDates.forEach(date => {
            const dateStr = date.toISOString().split('T')[0];
            const dateKey = `${selectedRoom.id}_${dateStr}`;
            const booking = bookings[dateKey] ? bookings[dateKey][period] : null;
            
            const td = document.createElement('td');
            
            if (booking) {
                td.className = 'cell-booked';
                td.innerHTML = `
                    <div class="cell-content">
                        <span class="booked-user">
                            <i data-lucide="user"></i>${booking.userName}
                        </span>
                        <span class="booked-purpose">${booking.purpose}</span>
                    </div>
                `;
                td.addEventListener('click', () => handleBookingClick(dateStr, period, booking));
            } else {
                td.className = 'cell-available';
                td.innerHTML = `
                    <div class="cell-content">
                        <i data-lucide="plus" style="width: 14px; height: 14px; margin-bottom: 2px;"></i>
                        예약 가능
                    </div>
                `;
                td.addEventListener('click', () => handleAvailableClick(dateStr, period));
            }
            
            tr.appendChild(td);
        });
        
        weekTableBody.appendChild(tr);
    }
    lucide.createIcons();
}

// Render Month View
function renderMonthView() {
    // 1. Update range display header (e.g., 2026년 5월)
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth(); // 0-indexed
    currentRangeDisplay.textContent = `${year}년 ${month + 1}월`;
    
    // 2. Calculate calendar numbers
    monthCalendarGrid.innerHTML = '';
    
    // First day of current month
    const firstDay = new Date(year, month, 1);
    // Starting weekday (0 = Sun, 1 = Mon ... 6 = Sat)
    const startWeekday = firstDay.getDay();
    // Number of days in current month
    const totalDays = new Date(year, month + 1, 0).getDate();
    // Number of days in previous month
    const prevMonthTotalDays = new Date(year, month, 0).getDate();
    
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Grid rendering (42 slots for a standard 7x6 grid)
    const totalGridSlots = 42;
    
    for (let slot = 0; slot < totalGridSlots; slot++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';
        
        let cellDate = null;
        let isCurrentMonth = true;
        let dayNum = 0;
        
        if (slot < startWeekday) {
            // Previous month overflow dates
            isCurrentMonth = false;
            dayNum = prevMonthTotalDays - (startWeekday - 1) + slot;
            cell.className += ' other-month';
            cellDate = new Date(year, month - 1, dayNum);
        } else if (slot >= startWeekday + totalDays) {
            // Next month overflow dates
            isCurrentMonth = false;
            dayNum = slot - (startWeekday + totalDays) + 1;
            cell.className += ' other-month';
            cellDate = new Date(year, month + 1, dayNum);
        } else {
            // Current month dates
            dayNum = slot - startWeekday + 1;
            cellDate = new Date(year, month, dayNum);
        }
        
        const dateStr = cellDate.toISOString().split('T')[0];
        
        // Check if date is today
        if (dateStr === todayStr) {
            cell.className += ' today';
        }
        
        cell.innerHTML = `<span class="day-number">${dayNum}</span>`;
        
        // Embed reservations container
        const resContainer = document.createElement('div');
        resContainer.className = 'calendar-reservations';
        
        const dateKey = `${selectedRoom.id}_${dateStr}`;
        const dayBookings = bookings[dateKey] || {};
        
        // Add badges for bookings in 1~6 periods
        let bookingCount = 0;
        for (let p = 1; p <= 6; p++) {
            const booking = dayBookings[p];
            if (booking) {
                bookingCount++;
                const badge = document.createElement('div');
                badge.className = 'cal-booking-badge';
                badge.textContent = `${p}교시: ${booking.userName}`;
                badge.title = `${p}교시 - ${booking.userName} (${booking.purpose})`;
                
                badge.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent trigger cell navigation click
                    handleBookingClick(dateStr, p, booking);
                });
                resContainer.appendChild(badge);
            }
        }
        
        cell.appendChild(resContainer);
        
        // Click on calendar date cell shifts views to Week View on that date
        cell.addEventListener('click', () => {
            referenceDate = new Date(cellDate);
            setViewMode('week');
        });
        
        monthCalendarGrid.appendChild(cell);
    }
}

// Handlers for grid interaction
function handleAvailableClick(dateStr, period) {
    activeTargetDate = dateStr;
    activePeriod = period;
    
    document.getElementById('modal-room-name').textContent = selectedRoom.name;
    document.getElementById('modal-subtitle').textContent = `${dateStr} | ${period}교시`;
    
    bookingModal.classList.remove('hidden');
    document.getElementById('user-name').focus();
}

function handleBookingClick(dateStr, period, booking) {
    activeTargetDate = dateStr;
    activePeriod = period;
    
    document.getElementById('detail-room').textContent = selectedRoom.name;
    document.getElementById('detail-user').textContent = `${booking.userName} 교사`;
    document.getElementById('detail-purpose').textContent = booking.purpose;
    document.getElementById('detail-time').textContent = `${dateStr} (${period}교시)`;
    
    detailModal.classList.remove('hidden');
}

// Booking submission (handles double-booking check)
async function handleBookingSubmit(e) {
    e.preventDefault();
    const userName = document.getElementById('user-name').value.trim();
    const purpose = document.getElementById('purpose').value.trim();
    
    if (!userName || !purpose) return;
    
    const dateKey = `${selectedRoom.id}_${activeTargetDate}`;
    
    // Double Booking Prevention check on local client state
    if (bookings[dateKey] && bookings[dateKey][activePeriod]) {
        showToast('이미 예약된 교시입니다. 중복 예약은 차단됩니다.', 'error');
        bookingModal.classList.add('hidden');
        bookingForm.reset();
        return;
    }
    
    if (isOnlineMode && supabase) {
        try {
            // Confirm with server database check
            const { data: dbCheck } = await supabase
                .from('bookings')
                .select('*')
                .eq('room_id', selectedRoom.id)
                .eq('booking_date', activeTargetDate)
                .eq('period', activePeriod);
                
            if (dbCheck && dbCheck.length > 0) {
                showToast('서버 상에 해당 교시 예약이 이미 등록되어 있습니다.', 'error');
                await loadInitialData();
                bookingModal.classList.add('hidden');
                bookingForm.reset();
                return;
            }
            
            // Insert
            const { error } = await supabase
                .from('bookings')
                .insert({
                    room_id: selectedRoom.id,
                    booking_date: activeTargetDate,
                    period: activePeriod,
                    user_name: userName,
                    purpose: purpose
                });
                
            if (error) throw error;
            showToast('예약이 정상 등록되었습니다.', 'success');
            
        } catch (err) {
            console.error('온라인 예약 등록 오류:', err);
            showToast('서버 등록에 실패했습니다. (DB 구성을 확인해 주세요)', 'error');
        }
    } else {
        // Local mode fallback saving
        if (!bookings[dateKey]) bookings[dateKey] = {};
        bookings[dateKey][activePeriod] = {
            userName,
            purpose,
            timestamp: Date.now()
        };
        saveLocalBookings();
        showToast('로컬 저장소에 예약이 등록되었습니다.', 'success');
    }
    
    bookingModal.classList.add('hidden');
    bookingForm.reset();
    
    if (!isOnlineMode) {
        renderView();
    } else {
        await loadInitialData();
    }
}

// Cancel booking
async function handleCancelBookingClick() {
    if (!confirm('정말로 이 예약을 취소하시겠습니까?')) return;
    
    const dateKey = `${selectedRoom.id}_${activeTargetDate}`;
    const targetBooking = bookings[dateKey] ? bookings[dateKey][activePeriod] : null;
    
    if (!targetBooking) return;
    
    if (isOnlineMode && supabase) {
        try {
            const { error } = await supabase
                .from('bookings')
                .delete()
                .eq('id', targetBooking.id);
                
            if (error) throw error;
            showToast('예약이 취소되었습니다.', 'success');
        } catch (err) {
            console.error('온라인 예약 취소 오류:', err);
            showToast('서버에서 예약을 취소하는 도중 에러가 발생했습니다.', 'error');
        }
    } else {
        delete bookings[dateKey][activePeriod];
        if (Object.keys(bookings[dateKey]).length === 0) {
            delete bookings[dateKey];
        }
        saveLocalBookings();
        showToast('로컬 예약이 취소되었습니다.', 'success');
    }
    
    detailModal.classList.add('hidden');
    
    if (!isOnlineMode) {
        renderView();
    } else {
        await loadInitialData();
    }
}

// Admin Form rendering
function renderAdminFormSelectors() {
    iconSelector.innerHTML = '';
    PRESET_ICONS.forEach((icon, idx) => {
        const item = document.createElement('div');
        item.className = `selector-icon-item ${idx === 0 ? 'active' : ''}`;
        item.dataset.icon = icon;
        item.innerHTML = `<i data-lucide="${icon}"></i>`;
        
        item.addEventListener('click', () => {
            document.querySelectorAll('.selector-icon-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            selectedAdminIcon = icon;
        });
        iconSelector.appendChild(item);
    });
    
    colorSelector.innerHTML = '';
    PRESET_COLORS.forEach((colorOpt, idx) => {
        const item = document.createElement('div');
        item.className = `selector-color-item ${idx === 0 ? 'active' : ''}`;
        item.style.setProperty('--color-val', colorOpt.color);
        
        item.addEventListener('click', () => {
            document.querySelectorAll('.selector-color-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            selectedAdminColor = colorOpt;
        });
        colorSelector.appendChild(item);
    });
}

function renderAdminRooms() {
    adminRoomList.innerHTML = '';
    rooms.forEach(room => {
        const li = document.createElement('li');
        li.className = 'admin-room-item';
        li.innerHTML = `
            <span>${room.name}</span>
            <button class="btn-delete-room" title="특별실 삭제">
                <i data-lucide="trash-2"></i>
            </button>
        `;
        li.querySelector('button').addEventListener('click', () => deleteRoom(room.id));
        adminRoomList.appendChild(li);
    });
    lucide.createIcons();
}

// Admin actions: Add Room
async function handleAddRoomSubmit(e) {
    e.preventDefault();
    const name = newRoomNameInput.value.trim();
    if (!name) return;
    
    if (isOnlineMode && supabase) {
        try {
            const { error } = await supabase
                .from('rooms')
                .insert({
                    name: name,
                    icon: selectedAdminIcon,
                    theme_color: selectedAdminColor.color,
                    theme_glow: selectedAdminColor.glow
                });
                
            if (error) throw error;
            showToast(`[${name}] 특별실이 추가되었습니다.`, 'success');
        } catch (err) {
            console.error('온라인 특별실 추가 오류:', err);
            showToast('서버 특별실 생성 실패.', 'error');
        }
    } else {
        const newRoom = {
            id: Date.now(),
            name: name,
            icon: selectedAdminIcon,
            theme_color: selectedAdminColor.color,
            theme_glow: selectedAdminColor.glow
        };
        rooms.push(newRoom);
        saveLocalRooms();
        showToast(`[${name}] 특별실이 로컬에 추가되었습니다.`, 'success');
    }
    
    newRoomNameInput.value = '';
    
    if (!isOnlineMode) {
        renderRoomTabs();
        renderAdminRooms();
    } else {
        await loadInitialData();
        renderAdminRooms();
    }
}

// Admin actions: Delete Room
async function deleteRoom(id) {
    const room = rooms.find(r => r.id === id);
    if (!room) return;
    
    if (!confirm(`[${room.name}] 특별실을 정말 삭제하시겠습니까?\n주의: 해당 실과 연동된 예약 내역도 조회할 수 없게 됩니다.`)) {
        return;
    }
    
    if (isOnlineMode && supabase) {
        try {
            // Delete bookings first
            await supabase.from('bookings').delete().eq('room_id', id);
            
            const { error } = await supabase
                .from('rooms')
                .delete()
                .eq('id', id);
                
            if (error) throw error;
            showToast(`[${room.name}] 특별실이 삭제되었습니다.`, 'success');
        } catch (err) {
            console.error('온라인 특별실 삭제 오류:', err);
            showToast('서버에서 삭제하는 도중 에러가 발생했습니다.', 'error');
        }
    } else {
        rooms = rooms.filter(r => r.id !== id);
        saveLocalRooms();
        showToast(`[${room.name}] 특별실이 로컬에서 삭제되었습니다.`, 'success');
    }
    
    // Clear selection if deleted
    if (selectedRoom && selectedRoom.id === id) {
        selectedRoom = rooms.length > 0 ? rooms[0] : null;
    }
    
    if (!isOnlineMode) {
        renderRoomTabs();
        renderAdminRooms();
        renderView();
    } else {
        await loadInitialData();
        renderAdminRooms();
    }
}

// Local Storage helpers
function saveLocalRooms() {
    localStorage.setItem(STORAGE_KEY_ROOMS, JSON.stringify(rooms));
}

function saveLocalBookings() {
    localStorage.setItem(STORAGE_KEY_BOOKINGS, JSON.stringify(bookings));
}

// Toast helper
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'check-circle';
    if (type === 'error') icon = 'alert-triangle';
    if (type === 'info') icon = 'info';
    
    toast.innerHTML = `
        <i data-lucide="${icon}"></i>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();
    
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 400);
    }, 3200);
}

init();
