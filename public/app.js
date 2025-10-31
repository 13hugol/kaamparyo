// TaskNow Frontend Logic
const API_URL = window.location.origin;
const NPR = (paisa) => `NPR ${(Number(paisa || 0) / 100).toLocaleString()}`;
let token = localStorage.getItem('token');
let currentUser = null;
let socket = null;
let map = null;
let marker = null;
let selectedLocation = { lat: 27.7172, lng: 85.3240 }; // Kathmandu default
let taskerLocation = null;
let taskerSearchRadiusKm = 5;
let isOnline = false;
let activeChatTaskId = null;
let taskerMap = null;
let taskerMarker = null;

// Init
document.addEventListener('DOMContentLoaded', () => {
  if (token) loadUser();
  attachModalHandlers();
  attachTabHandlers();
  loadCategories();
});

function attachModalHandlers() {
  const postTaskModal = document.getElementById('postTaskModal');
  if (postTaskModal) {
    postTaskModal.addEventListener('shown.bs.modal', () => {
      setTimeout(() => initMap(), 50);
    });
  }
  const setLocModal = document.getElementById('setLocationModal');
  if (setLocModal) {
    setLocModal.addEventListener('shown.bs.modal', () => {
      setTimeout(() => initTaskerMap(), 50);
    });
  }
}

function attachTabHandlers() {
  // Mobile bottom nav uses switchTab; also bind tab events for desktop
  document.querySelectorAll('a[data-bs-toggle="pill"]').forEach(tab => {
    tab.addEventListener('shown.bs.tab', (e) => {
      const target = e.target.getAttribute('href');
      if (target === '#available-tasks' && taskerLocation) {
        loadNearbyTasks();
      }
      if (target === '#active-tasks') {
        loadMyAcceptedTasks();
      }
      if (target === '#my-posted-tasks') {
        loadMyTasks();
      }
      if (target === '#stats-panel') {
        loadStats();
      }
    });
  });
}

// Landing helpers
function showLanding() {
  document.getElementById('hero-section').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');
}

function scrollToFeatures() {
  document.getElementById('features-section').scrollIntoView({ behavior: 'smooth' });
}

// Auth
function showLogin() {
  const modal = new bootstrap.Modal(document.getElementById('loginModal'));
  modal.show();
  document.getElementById('phone-step').classList.remove('hidden');
  document.getElementById('otp-step').classList.add('hidden');
  document.getElementById('profile-step').classList.add('hidden');
}

async function requestOTP() {
  const phone = document.getElementById('phone-input').value.trim();
  if (!phone) return showToast('Please enter phone number', 'danger');
  try {
    const res = await fetch(`${API_URL}/auth/request-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
    const data = await res.json();
    if (res.ok) {
      showToast('OTP sent! Check console/server logs', 'success');
      document.getElementById('phone-step').classList.add('hidden');
      document.getElementById('otp-step').classList.remove('hidden');
      if (data.debugOtp) {
        const otpInput = document.getElementById('otp-input');
        if (otpInput) otpInput.value = data.debugOtp;
      }
    } else {
      showToast(data.error || 'Failed to send OTP', 'danger');
    }
  } catch (e) { showToast(e.message, 'danger'); }
}

async function verifyOTP() {
  const phone = document.getElementById('phone-input').value.trim();
  const otp = document.getElementById('otp-input').value.trim();
  if (!otp) return showToast('Enter OTP', 'danger');
  try {
    const res = await fetch(`${API_URL}/auth/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, otp }) });
    const data = await res.json();
    if (res.ok) {
      token = data.token; localStorage.setItem('token', token); currentUser = data.user;
      if (!currentUser.name) {
        document.getElementById('otp-step').classList.add('hidden');
        document.getElementById('profile-step').classList.remove('hidden');
      } else {
        bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
        enterApp(currentUser);
      }
    } else { showToast(data.error || 'Invalid OTP', 'danger'); }
  } catch (e) { showToast(e.message, 'danger'); }
}

async function updateProfile() {
  const name = document.getElementById('name-input').value.trim();
  if (!name) return showToast('Please enter your name', 'danger');
  try {
    const res = await fetch(`${API_URL}/auth/me`, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ name, lat: selectedLocation.lat, lng: selectedLocation.lng }) });
    if (res.ok) {
      bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
      await loadUser();
    }
  } catch (e) { showToast(e.message, 'danger'); }
}

async function loadUser() {
  try {
    const res = await fetch(`${API_URL}/auth/me`, { headers: authHeaders() });
    if (!res.ok) { return logout(); }
    const data = await res.json();
    enterApp(data.user);
  } catch (e) { logout(); }
}

function enterApp(user) {
  currentUser = user || currentUser;
  isOnline = !!currentUser?.isOnline;
  const hero = document.getElementById('hero-section'); if (hero) hero.classList.add('hidden');
  const appc = document.getElementById('app-container'); if (appc) appc.classList.remove('hidden');
  const navLogin = document.getElementById('nav-login'); if (navLogin) navLogin.classList.add('hidden');
  const navUser = document.getElementById('nav-user'); if (navUser) navUser.classList.remove('hidden');
  const uname = document.getElementById('user-name'); if (uname) uname.textContent = (currentUser?.name || currentUser?.phone || 'User');
  updateOnlineToggle();
  connectSocket();
  loadMyTasks();
  loadCategories();
}

// Mobile helpers
function switchTab(hash) {
  const link = document.querySelector(`a[href='${hash}']`);
  if (link) {
    const tab = new bootstrap.Tab(link);
    tab.show();
  }
}

function openPostTaskFab() {
  const modal = new bootstrap.Modal(document.getElementById('postTaskModal'));
  modal.show();
}

window.switchTab = switchTab;
window.openPostTaskFab = openPostTaskFab;

function logout() {
  token = null; currentUser = null; localStorage.removeItem('token');
  document.getElementById('hero-section').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');
  document.getElementById('nav-login').classList.remove('hidden');
  document.getElementById('nav-user').classList.add('hidden');
  if (socket) socket.disconnect();
}

function authHeaders(extra={}) { return { 'Authorization': `Bearer ${token}`, ...extra }; }

// Socket
function connectSocket() {
  if (socket) { socket.disconnect(); }
  socket = io(API_URL);
  socket.on('connect', () => {
    socket.emit('join_tasker');
    socket.emit('join_requester');
  });
  socket.on('task_posted', (data) => { if (isOnline) { loadNearbyTasks(); showTaskToast(data); playBeep(); } else { showTaskToast(data); playBeep(); } });
  socket.on('task_assigned', () => { loadMyTasks(); loadMyAcceptedTasks(); showToast('Task accepted', 'info'); playBeep(); });
  socket.on('task_completed', () => { loadMyTasks(); showToast('Task completed', 'info'); playBeep(); });
  socket.on('task_paid', () => { loadMyTasks(); loadMyAcceptedTasks(); showToast('Payment captured', 'success'); playBeep(); });
  socket.on('message', (msg) => {
    if (activeChatTaskId && msg.taskId === activeChatTaskId) appendChatMessage(msg.from === currentUser._id ? 'You' : 'Them', msg.text, msg.createdAt);
    else { showToast('New chat message', 'info'); playBeep(); }
  });
  socket.on('task_cancelled', (p) => {
    loadMyTasks(); loadMyAcceptedTasks();
    showToast(p?.reposted ? 'Task refunded and reposted' : 'Task refunded', p?.reposted ? 'info' : 'warning');
    playBeep();
  });
}

function playBeep() {
  try { const ctx = new (window.AudioContext||window.webkitAudioContext)(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type='sine'; o.frequency.value=880; g.gain.value=0.05; o.start(); setTimeout(()=>{ o.stop(); ctx.close(); }, 150); } catch {}
}

// Online toggle
async function toggleOnline() {
  try {
    isOnline = !isOnline;
    const res = await fetch(`${API_URL}/auth/me`, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ isOnline }) });
    if (res.ok) { updateOnlineToggle(); showToast(isOnline ? 'You are online' : 'You are offline', 'info'); }
  } catch (e) { showToast(e.message, 'danger'); }
}

function updateOnlineToggle() {
  const btn = document.getElementById('online-toggle-btn'); if (!btn) return;
  btn.innerHTML = isOnline ? '<i class="bi bi-toggle-on"></i> Online' : '<i class="bi bi-toggle-off"></i> Go Online';
  btn.className = isOnline ? 'btn btn-outline-success me-2' : 'btn btn-outline-secondary me-2';
}

// Map using MapLibre GL with OpenFreeMap
function initMap() {
  if (!window.maplibregl) {
    console.warn('MapLibre GL not loaded yet, retrying...');
    setTimeout(initMap, 500);
    return;
  }
  
  if (!map) {
    const mapEl = document.getElementById('map');
    
    // GTA V style dark map
    map = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: {
          'dark-tiles': {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© CartoDB'
          }
        },
        layers: [{
          id: 'dark-tiles',
          type: 'raster',
          source: 'dark-tiles',
          minzoom: 0,
          maxzoom: 22
        }]
      },
      center: [selectedLocation.lng, selectedLocation.lat],
      zoom: 13
    });
    
    // Add navigation controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    // Add "Use Current Location" button
    const locationBtn = document.createElement('div');
    locationBtn.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    locationBtn.innerHTML = `
      <button class="maplibre-style-btn" onclick="useCurrentLocation()" title="Use Current Location">
        <i class="bi bi-crosshair"></i> Use My Location
      </button>
    `;
    map.addControl({ onAdd: () => locationBtn, onRemove: () => {} }, 'top-left');
    
    // Add style switcher
    const styleControl = document.createElement('div');
    styleControl.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    styleControl.innerHTML = `
      <button class="maplibre-style-btn" onclick="switchMapStyle('map', 'gta')" title="GTA V Dark">
        <i class="bi bi-moon-stars-fill"></i>
      </button>
      <button class="maplibre-style-btn" onclick="switchMapStyle('map', 'street')" title="Street View">
        <i class="bi bi-map"></i>
      </button>
      <button class="maplibre-style-btn" onclick="switchMapStyle('map', 'satellite')" title="Satellite View">
        <i class="bi bi-globe"></i>
      </button>
    `;
    map.addControl({ onAdd: () => styleControl, onRemove: () => {} }, 'bottom-left');
    
    // Create marker
    marker = new maplibregl.Marker({ draggable: true, color: '#dc2626' })
      .setLngLat([selectedLocation.lng, selectedLocation.lat])
      .addTo(map);
    
    // Click to set location
    map.on('click', (e) => {
      selectedLocation = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      marker.setLngLat([e.lngLat.lng, e.lngLat.lat]);
      updateLocationDisplay();
    });
    
    // Drag marker
    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      selectedLocation = { lat: lngLat.lat, lng: lngLat.lng };
      updateLocationDisplay();
    });
  }
  setTimeout(() => { updateLocationDisplay(); }, 100);
}

function updateLocationDisplay() {
  const latEl = document.getElementById('selected-lat'); const lngEl = document.getElementById('selected-lng');
  if (latEl && lngEl) { latEl.textContent = selectedLocation.lat.toFixed(4); lngEl.textContent = selectedLocation.lng.toFixed(4); }
}

window.useCurrentLocation = function() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported by your browser', 'danger');
    return;
  }
  
  showToast('Getting your location...', 'info', 2000);
  
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    selectedLocation = { lat: latitude, lng: longitude };
    
    if (map && marker) {
      // Smooth pan to current location
      map.flyTo({
        center: [longitude, latitude],
        zoom: 15,
        duration: 2000,
        essential: true
      });
      
      marker.setLngLat([longitude, latitude]);
      updateLocationDisplay();
      
      // Add pulse effect
      const pulseEl = document.createElement('div');
      pulseEl.className = 'location-pulse';
      pulseEl.style.cssText = `
        width: 20px;
        height: 20px;
        background: #3b82f6;
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        animation: pulse 2s ease-out;
        pointer-events: none;
      `;
      
      const pulseMarker = new maplibregl.Marker({ element: pulseEl })
        .setLngLat([longitude, latitude])
        .addTo(map);
      
      setTimeout(() => pulseMarker.remove(), 2000);
      
      showToast('Location set to your current position', 'success');
    }
  }, (err) => {
    showToast('Unable to get your location: ' + err.message, 'danger');
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  });
};

window.useTaskerCurrentLocation = function() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported by your browser', 'danger');
    return;
  }
  
  showToast('Getting your location...', 'info', 2000);
  
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    
    if (taskerMap && taskerMarker) {
      // Smooth pan to current location
      taskerMap.flyTo({
        center: [longitude, latitude],
        zoom: 15,
        duration: 2000,
        essential: true
      });
      
      taskerMarker.setLngLat([longitude, latitude]);
      updateTaskerMapDisplay(latitude, longitude);
      
      // Add pulse effect
      const pulseEl = document.createElement('div');
      pulseEl.className = 'location-pulse';
      pulseEl.style.cssText = `
        width: 20px;
        height: 20px;
        background: #3b82f6;
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        animation: pulse 2s ease-out;
        pointer-events: none;
      `;
      
      const pulseMarker = new maplibregl.Marker({ element: pulseEl })
        .setLngLat([longitude, latitude])
        .addTo(taskerMap);
      
      setTimeout(() => pulseMarker.remove(), 2000);
      
      showToast('Location set to your current position', 'success');
    }
  }, (err) => {
    showToast('Unable to get your location: ' + err.message, 'danger');
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  });
};

function getMyLocation() {
  if (!navigator.geolocation) return showToast('Geolocation not available', 'warning');
  navigator.geolocation.getCurrentPosition((pos) => {
    taskerLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    updateTaskerLocationInline();
    showToast('Location set', 'success');
  }, () => showToast('Could not get location', 'danger'));
}

function updateTaskerLocationInline() {
  const el = document.getElementById('tasker-location'); if (el && taskerLocation) el.textContent = `${taskerLocation.lat.toFixed(4)}, ${taskerLocation.lng.toFixed(4)}`;
  const r = document.getElementById('tasker-radius-label'); if (r) r.textContent = String(taskerSearchRadiusKm);
}

function openSetLocationModal() {
  const modal = new bootstrap.Modal(document.getElementById('setLocationModal'));
  modal.show();
}

function initTaskerMap() {
  if (!window.maplibregl) {
    console.warn('MapLibre GL not loaded yet, retrying...');
    setTimeout(initTaskerMap, 500);
    return;
  }
  
  const def = taskerLocation || selectedLocation || { lat: 27.7172, lng: 85.3240 };
  const mapEl = document.getElementById('tasker-map'); if (!mapEl) return;
  if (!taskerMap) {
    // GTA V style dark map
    taskerMap = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: {
          'dark-tiles': {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© CartoDB'
          }
        },
        layers: [{
          id: 'dark-tiles',
          type: 'raster',
          source: 'dark-tiles',
          minzoom: 0,
          maxzoom: 22
        }]
      },
      center: [def.lng, def.lat],
      zoom: 13
    });
    
    // Add navigation controls
    taskerMap.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    // Add "Use Current Location" button
    const locationBtn = document.createElement('div');
    locationBtn.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    locationBtn.innerHTML = `
      <button class="maplibre-style-btn" onclick="useTaskerCurrentLocation()" title="Use Current Location">
        <i class="bi bi-crosshair"></i> Use My Location
      </button>
    `;
    taskerMap.addControl({ onAdd: () => locationBtn, onRemove: () => {} }, 'top-left');
    
    // Add style switcher
    const styleControl = document.createElement('div');
    styleControl.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    styleControl.innerHTML = `
      <button class="maplibre-style-btn" onclick="switchMapStyle('tasker', 'gta')" title="GTA V Dark">
        <i class="bi bi-moon-stars-fill"></i>
      </button>
      <button class="maplibre-style-btn" onclick="switchMapStyle('tasker', 'street')" title="Street View">
        <i class="bi bi-map"></i>
      </button>
      <button class="maplibre-style-btn" onclick="switchMapStyle('tasker', 'satellite')" title="Satellite View">
        <i class="bi bi-globe"></i>
      </button>
    `;
    taskerMap.addControl({ onAdd: () => styleControl, onRemove: () => {} }, 'bottom-left');
    
    // Create marker
    taskerMarker = new maplibregl.Marker({ draggable: true, color: '#dc2626' })
      .setLngLat([def.lng, def.lat])
      .addTo(taskerMap);
    
    // Click to set location
    taskerMap.on('click', (e) => {
      taskerMarker.setLngLat([e.lngLat.lng, e.lngLat.lat]);
      updateTaskerMapDisplay(e.lngLat.lat, e.lngLat.lng);
    });
    
    // Drag marker
    taskerMarker.on('dragend', () => {
      const lngLat = taskerMarker.getLngLat();
      updateTaskerMapDisplay(lngLat.lat, lngLat.lng);
    });
  } else {
    taskerMap.setCenter([def.lng, def.lat]);
    taskerMarker.setLngLat([def.lng, def.lat]);
  }
  document.getElementById('tasker-radius').value = taskerSearchRadiusKm;
  updateTaskerMapDisplay(def.lat, def.lng);
}

function updateTaskerMapDisplay(lat, lng) {
  document.getElementById('tasker-lat').textContent = Number(lat).toFixed(5);
  document.getElementById('tasker-lng').textContent = Number(lng).toFixed(5);
}

async function saveTaskerLocation() {
  if (!taskerMarker) return;
  const lngLat = taskerMarker.getLngLat();
  taskerLocation = { lat: lngLat.lat, lng: lngLat.lng };
  taskerSearchRadiusKm = Math.max(1, Number(document.getElementById('tasker-radius').value) || 5);
  updateTaskerLocationInline();
  // Optionally persist to profile
  try { await fetch(`${API_URL}/auth/me`, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ lat: taskerLocation.lat, lng: taskerLocation.lng }) }); } catch {}
  bootstrap.Modal.getInstance(document.getElementById('setLocationModal')).hide();
  showToast('Search location updated', 'success');
  loadNearbyTasks();
}

// Categories
async function loadCategories() {
  try {
    const res = await fetch(`${API_URL}/categories`);
    const data = await res.json();
    const select = document.getElementById('task-category'); if (!select) return;
    select.innerHTML = '<option value="">Select category</option>';
    const customOpt = document.createElement('option'); customOpt.value = 'custom'; customOpt.textContent = 'Custom (describe below)'; select.appendChild(customOpt);
    (data.categories || []).forEach(cat => {
      if (cat._id === 'custom') return;
      const opt = document.createElement('option'); opt.value = cat._id; opt.textContent = `${cat.name} (NPR ${(cat.minPrice/100).toLocaleString()}-${(cat.maxPrice/100).toLocaleString()})`; select.appendChild(opt);
    });
    renderCategoriesList(data.categories || []);
  } catch {}
}

function onCategoryChange() {
  const val = document.getElementById('task-category').value;
  const input = document.getElementById('task-category-custom');
  if (val === 'custom') input.classList.remove('hidden'); else input.classList.add('hidden');
}
window.onCategoryChange = onCategoryChange;

function renderCategoriesList(categories) {
  const container = document.getElementById('categories-list'); if (!container) return;
  if (!categories.length) { container.innerHTML = '<p class="text-muted mb-0">No categories yet</p>'; return; }
  container.innerHTML = categories.map(c => `<div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2"><div><strong>${escapeHtml(c.name)}</strong><div class="small text-muted">NPR ${(c.minPrice/100).toLocaleString()} - ${(c.maxPrice/100).toLocaleString()}</div></div><code class="small">${c._id}</code></div>`).join('');
}

// Post Task
const createTaskForm = document.getElementById('create-task-form');
if (createTaskForm) {
createTaskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sel = document.getElementById('task-category').value;
    const taskData = {
      title: document.getElementById('task-title').value,
      description: document.getElementById('task-description').value,
      categoryId: sel,
      categoryName: sel === 'custom' ? document.getElementById('task-category-custom').value : undefined,
      price: parseInt(document.getElementById('task-price').value, 10) * 100,
      durationMin: parseInt(document.getElementById('task-duration').value, 10) || 0,
      lat: selectedLocation.lat,
      lng: selectedLocation.lng,
      radiusKm: parseInt(document.getElementById('task-radius').value, 10)
    };
    if (sel === 'custom' && !taskData.categoryName) { showToast('Please describe your custom category', 'warning'); return; }
    try {
      const res = await fetch(`${API_URL}/tasks`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(taskData) });
      const data = await res.json();
      if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('postTaskModal')).hide();
        openDemoCheckout({ taskId: data.taskId, amount: taskData.price, title: taskData.title });
        createTaskForm.reset();
        loadMyTasks();
      } else {
        showToast(data.error || 'Failed to post task', 'danger');
      }
    } catch (e) { showToast(e.message, 'danger'); }
  });

// Demo checkout helpers
let lastDemoCheckout = null;
function openDemoCheckout(info) {
  lastDemoCheckout = info;
  document.getElementById('demo-checkout-title').textContent = info.title || 'Task';
  document.getElementById('demo-checkout-amount').textContent = NPR(info.amount);
  const modal = new bootstrap.Modal(document.getElementById('demoCheckoutModal'));
  modal.show();
}

async function simulateCheckoutSuccess() {
  // Nothing to call; posting already held funds in demo. Just close modal.
  bootstrap.Modal.getInstance(document.getElementById('demoCheckoutModal')).hide();
  showToast('Demo payment authorized', 'success');
}

async function simulateCheckoutFail() {
  // Cancel task and close modal
  try {
    if (lastDemoCheckout?.taskId) {
      const res = await fetch(`${API_URL}/tasks/${lastDemoCheckout.taskId}`, { method: 'DELETE', headers: authHeaders() });
      await res.json();
    }
  } catch {}
  bootstrap.Modal.getInstance(document.getElementById('demoCheckoutModal')).hide();
  showToast('Demo payment failed — task removed', 'danger');
  loadMyTasks();
}

window.simulateCheckoutSuccess = simulateCheckoutSuccess;
window.simulateCheckoutFail = simulateCheckoutFail;
window.openDemoCheckout = openDemoCheckout;

// Edit task UI
let editingTaskId = null;
function openEditTask(taskId) {
  editingTaskId = taskId;
  const t = (window._myTasksCache || []).find(x => x._id === taskId);
  if (t) {
    document.getElementById('edit-title').value = t.title || '';
    document.getElementById('edit-description').value = t.description || '';
    document.getElementById('edit-price').value = Math.round((t.price||0)/100);
    document.getElementById('edit-duration').value = t.durationMin || 0;
  }
  new bootstrap.Modal(document.getElementById('editTaskModal')).show();
}
async function saveEditTask() {
  if (!editingTaskId) return;
  const payload = {
    title: document.getElementById('edit-title').value,
    description: document.getElementById('edit-description').value,
    price: parseInt(document.getElementById('edit-price').value,10) * 100,
    durationMin: parseInt(document.getElementById('edit-duration').value,10) || 0
  };
  try {
    const res = await fetch(`${API_URL}/tasks/${editingTaskId}`, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) });
    const data = await res.json();
    if (res.ok) { showToast('Task updated', 'success'); loadMyTasks(); bootstrap.Modal.getInstance(document.getElementById('editTaskModal')).hide(); }
    else showToast(data.error || 'Failed to update', 'danger');
  } catch(e) { showToast(e.message, 'danger'); }
}
window.openEditTask = openEditTask;
window.saveEditTask = saveEditTask;
}

// My Posted Tasks
async function loadMyTasks() {
  window._myTasksCache = [];
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_URL}/users/${currentUser._id}/tasks/requested`, { headers: authHeaders() });
const data = await res.json();
    window._myTasksCache = data.tasks || [];
    renderMyTasks(window._myTasksCache);
  } catch {}
}

function renderMyTasks(tasks) {
  const container = document.getElementById('my-tasks-list'); if (!container) return;
  if (!tasks.length) { return container.innerHTML = emptyState('No tasks yet', 'Post your first task to get help.'); }
  container.innerHTML = tasks.map(task => `
    <div class="task-card">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta"><span class="badge badge-${task.status}">${task.status}</span></div>
        </div>
        <div class="task-price">${NPR(task.price)}</div>
      </div>
      <div class="mt-2 d-flex gap-2 flex-wrap">
        ${task.status === 'posted' ? `<button class=\"btn btn-outline-secondary btn-sm\" onclick=\"openEditTask('${task._id}')\">Edit</button>` : ''}
        ${task.status === 'posted' ? `<button class=\"btn btn-outline-danger btn-sm\" onclick=\"deleteTask('${task._id}')\">Delete</button>` : ''}
        ${['accepted','in_progress'].includes(task.status) ? `<button class="btn btn-danger btn-sm" onclick="openLiveTracking('${task._id}')"><i class="bi bi-broadcast"></i> Track Live</button>` : ''}
        ${['accepted','in_progress'].includes(task.status) ? `<button class="btn btn-outline-danger btn-sm" onclick="deleteTask('${task._id}')">Cancel</button>` : ''}
        ${task.status === 'completed' ? `<button class="btn btn-success btn-sm" onclick="approveTask('${task._id}')">Approve & Pay</button>` : ''}
        ${['accepted','in_progress','completed','paid'].includes(task.status) ? `<button class="btn btn-outline-primary btn-sm" onclick="openChat('${task._id}')">Chat</button>` : ''}
${task.proofUrl ? (/(\.mp4|\.webm|\.mov)$/i.test(task.proofUrl) ? `<video src=\"${API_URL}${task.proofUrl}\" class=\"mt-2 rounded\" style=\"max-height:150px;width:100%\" controls playsinline></video>` : `<a class=\"btn btn-outline-secondary btn-sm\" href=\"${API_URL}${task.proofUrl}\" target=\"_blank\">View Proof</a>`) : ''}
        ${task.status === 'paid' ? `<button class="btn btn-outline-success btn-sm" onclick="rateTask('${task._id}')">Rate</button>` : ''}
      </div>
    </div>
  `).join('');
}

// Nearby Tasks
async function loadNearbyTasks() {
  if (!taskerLocation) return showToast('Set your location first', 'warning');
  try {
const url = `${API_URL}/tasks/nearby?lat=${taskerLocation.lat}&lng=${taskerLocation.lng}&radiusKm=${taskerSearchRadiusKm}`;
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    renderNearbyTasks(data.tasks || []);
  } catch {}
}

function renderNearbyTasks(tasks) {
  const container = document.getElementById('nearby-tasks-list'); if (!container) return;
  if (!tasks.length) return container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-geo"></i></div><div class="empty-state-title">No tasks nearby</div><div class="empty-state-text">Try increasing your radius or come back later.</div></div>`;
  container.innerHTML = tasks.map(task => `
    <div class="task-card">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">${escapeHtml(task.description || 'No description')}</div>
        </div>
<div class=\"task-price\">${NPR(task.price)}</div>
      </div>
      <div class="mt-2 d-flex gap-2">
        <button class="btn btn-primary btn-sm" onclick="acceptTask('${task._id}')">Accept</button>
      </div>
    </div>
  `).join('');
}

// Accepted Tasks
async function loadMyAcceptedTasks() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_URL}/users/${currentUser._id}/tasks/assigned`, { headers: authHeaders() });
    const data = await res.json();
    const container = document.getElementById('my-accepted-tasks'); if (!container) return;
    if (!data.tasks.length) return container.innerHTML = emptyState('No accepted tasks', 'Accept a nearby task to get started.');
    container.innerHTML = data.tasks.map(task => `
      <div class="task-card">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-meta"><span class="badge badge-${task.status}">${task.status}</span></div>
          </div>
          <div class="task-price">${NPR(task.price)}</div>
        </div>
        <div class="mt-2 d-flex gap-2 flex-wrap">
          ${task.status === 'accepted' ? `<button class="btn btn-secondary btn-sm" onclick="startTask('${task._id}')">Start</button>` : ''}
          ${['accepted','in_progress'].includes(task.status) ? `<button class="btn btn-danger btn-sm" onclick="openLiveTracking('${task._id}')"><i class="bi bi-broadcast"></i> Share Location</button>` : ''}
          ${['accepted','in_progress'].includes(task.status) ? `<button class="btn btn-success btn-sm" onclick="showUploadProof('${task._id}')">Upload Proof</button>` : ''}
          ${['accepted','in_progress'].includes(task.status) ? `<button class="btn btn-outline-danger btn-sm" onclick="rejectTask('${task._id}')">Reject</button>` : ''}
          ${['accepted','in_progress','completed','paid'].includes(task.status) ? `<button class="btn btn-outline-primary btn-sm" onclick="openChat('${task._id}')">Chat</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch {}
}

async function rejectTask(taskId) {
  if (!confirm('Reject this task? Funds will be refunded to the poster.')) return;
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}/reject`, { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    if (res.ok) { showToast('Task rejected and refunded', 'success'); loadMyAcceptedTasks(); }
    else showToast(data.error || 'Failed to reject', 'danger');
  } catch (e) { showToast(e.message, 'danger'); }
}

// Actions
async function acceptTask(taskId) {
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}/accept`, { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    if (res.ok) { showToast('Task accepted', 'success'); loadNearbyTasks(); loadMyAcceptedTasks(); }
    else showToast(data.error || 'Failed to accept', 'danger');
  } catch (e) { showToast(e.message, 'danger'); }
}

async function startTask(taskId) {
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}/start`, { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    if (res.ok) { showToast('Task started', 'info'); loadMyAcceptedTasks(); }
    else showToast(data.error || 'Failed to start', 'danger');
  } catch (e) { showToast(e.message, 'danger'); }
}

function showUploadProof(taskId) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const formData = new FormData(); formData.append('proof', file);
    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}/upload-proof`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
      if (res.ok) { showToast('Proof uploaded', 'success'); loadMyAcceptedTasks(); loadMyTasks(); }
      else showToast('Failed to upload proof', 'danger');
    } catch (e) { showToast(e.message, 'danger'); }
  };
  input.click();
}

async function deleteTask(taskId) {
  if (!confirm('Delete/cancel this task?')) return;
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (res.ok) {
      showToast('Task removed', 'success');
      loadMyTasks();
      const tab = document.querySelector("a[href='#available-tasks']");
      if (tab) { /* refresh available if needed */ }
    } else {
      showToast(data.error || 'Failed to remove task', 'danger');
    }
  } catch (e) { showToast(e.message, 'danger'); }
}

async function approveTask(taskId) {
  if (!confirm('Approve this task and release payment?')) return;
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}/approve`, { method: 'POST', headers: authHeaders() });
    if (res.ok) { showToast('Payment released', 'success'); loadMyTasks(); }
    else showToast('Failed to approve', 'danger');
  } catch (e) { showToast(e.message, 'danger'); }
}

async function rateTask(taskId) {
  const ratingStr = prompt('Rate 1-5'); if (!ratingStr) return;
  const rating = parseInt(ratingStr, 10); const comment = prompt('Optional comment:') || '';
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}/review`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ rating, comment }) });
    const data = await res.json();
    if (res.ok) showToast('Thanks for rating!', 'success');
    else showToast(data.error || 'Failed to rate', 'danger');
  } catch (e) { showToast(e.message, 'danger'); }
}

// Chat
async function openChat(taskId) {
  activeChatTaskId = taskId;
  document.getElementById('chat-messages').innerHTML = '';
  const modal = new bootstrap.Modal(document.getElementById('chatModal'));
  modal.show();
  await loadChatMessages(taskId);
}

async function loadChatMessages(taskId) {
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}/messages`, { headers: authHeaders() });
    const data = await res.json();
    (data.messages || []).forEach(m => appendChatMessage(m.from === currentUser._id ? 'You' : 'Them', m.text, m.createdAt));
  } catch {}
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input'); const text = input.value.trim(); if (!text) return; input.value = '';
  try {
    const res = await fetch(`${API_URL}/tasks/${activeChatTaskId}/messages`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ text }) });
    if (!res.ok) showToast('Failed to send', 'danger');
  } catch (e) { showToast(e.message, 'danger'); }
}

function appendChatMessage(sender, text, ts) {
  const wrap = document.createElement('div');
  const sent = sender === 'You';
  wrap.className = `chat-message ${sent ? 'chat-message-sent' : 'chat-message-received'}`;
  wrap.innerHTML = `<div><strong>${sender}:</strong> ${escapeHtml(text)}</div><div class="chat-time">${new Date(ts).toLocaleTimeString()}</div>`;
  const cont = document.getElementById('chat-messages'); cont.appendChild(wrap); cont.scrollTop = cont.scrollHeight;
}

// Stats
async function loadStats() {
  try {
    const mres = await fetch(`${API_URL}/users/${currentUser._id}/metrics`, { headers: authHeaders() });
    if (mres.ok) {
      const mdata = await mres.json();
      const m = mdata.metrics;
      document.getElementById('stat-posted-total').textContent = m.postedTotal;
      document.getElementById('stat-tasker-earned').textContent = NPR(m.taskerEarned);
      document.getElementById('stat-completed').textContent = m.taskerCompleted;
const feesEl = document.getElementById('stat-fees-pending'); if (feesEl) feesEl.textContent = NPR((m.feesFromMyEarnings ?? 0) || (m.platformFeesPending ?? 0));
    }
  } catch {}
}

// Profile & Wallet
function showProfile() {
  if (!currentUser) return;
  document.getElementById('profile-avatar').textContent = (currentUser.name || currentUser.phone || 'U')[0].toUpperCase();
  document.getElementById('profile-name').textContent = currentUser.name || 'User';
  document.getElementById('profile-phone').textContent = currentUser.phone || '';
  document.getElementById('profile-rating').textContent = (currentUser.ratingAvg || 0).toFixed(1);
  document.getElementById('profile-tasks').textContent = currentUser.ratingCount || 0;
  const modal = new bootstrap.Modal(document.getElementById('profileModal'));
  modal.show();
}

async function showWallet() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_URL}/users/${currentUser._id}/wallet`, { headers: authHeaders() });
    const data = await res.json();
    alert(`Wallet Balance: NPR ${data.wallet.balance / 100}\nPending: NPR ${data.wallet.pending / 100}`);
  } catch { showToast('Failed to load wallet', 'danger'); }
}

// Utils
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }
function emptyState(title, text) { return `<div class=\"empty-state\"><div class=\"empty-state-icon\"><i class=\\\"bi bi-inbox\\\"></i></div><div class=\"empty-state-title\">${escapeHtml(title)}</div><div class=\"empty-state-text\">${escapeHtml(text)}</div></div>`; }

// Toast helper
function showToast(message, type = 'info', timeout = 5000) {
  try {
    const container = document.getElementById('toast-container');
    if (!container) { console.log(`[${type}]`, message); return; }
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${type} border-0`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>`;
    container.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { delay: timeout });
    bsToast.show();
    setTimeout(() => toast.remove(), timeout + 500);
  } catch (e) {
    // Fallback
    alert(message);
  }
}

// Expose APIs for inline handlers
window.showLogin = showLogin;
window.requestOTP = requestOTP;
window.verifyOTP = verifyOTP;
window.updateProfile = updateProfile;
window.toggleOnline = toggleOnline;
window.getMyLocation = getMyLocation;
window.openChat = openChat;
window.sendChatMessage = sendChatMessage;
window.showUploadProof = showUploadProof;
window.approveTask = approveTask;
window.acceptTask = acceptTask;
window.startTask = startTask;
window.rateTask = rateTask;
window.openSetLocationModal = openSetLocationModal;
window.saveTaskerLocation = saveTaskerLocation;
window.showProfile = showProfile;
window.showWallet = showWallet;
window.showToast = showToast;

// Pop-down task toast
function showTaskToast(d) {
  const title = d?.title || 'New task';
  const amount = d?.price ? NPR(d.price) : '';
  const toast = document.createElement('div');
  toast.className = `toast align-items-center text-bg-info border-0`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">
        <strong>${escapeHtml(title)}</strong> ${amount}
        <div class="small text-white-50">Tap to view available</div>
      </div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>`;
  const container = document.getElementById('toast-container');
  container.appendChild(toast);
  toast.addEventListener('click', () => { const link = document.querySelector("a[href='#available-tasks']"); if (link) new bootstrap.Tab(link).show(); });
  const bsToast = new bootstrap.Toast(toast, { delay: 5000 });
  bsToast.show();
  setTimeout(() => toast.remove(), 5500);
}
window.showTaskToast = showTaskToast;
window.deleteTask = deleteTask;

// Live Tracking System
let liveTrackingMap = null;
let taskerMarkerLive = null;
let requesterMarkerLive = null;
let routeLine = null;
let trackingTaskId = null;
let locationUpdateInterval = null;

window.openLiveTracking = async function(taskId) {
  trackingTaskId = taskId;
  const modal = new bootstrap.Modal(document.getElementById('liveTrackingModal'));
  modal.show();
  
  setTimeout(() => initLiveTrackingMap(taskId), 300);
  startLocationSharing(taskId);
};

function initLiveTrackingMap(taskId) {
  if (!window.maplibregl) return;
  
  const mapEl = document.getElementById('live-tracking-map');
  if (!mapEl) return;
  
  if (!liveTrackingMap) {
    // GTA V style dark map for live tracking
    liveTrackingMap = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: {
          'dark-tiles': {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© CartoDB'
          }
        },
        layers: [{
          id: 'dark-tiles',
          type: 'raster',
          source: 'dark-tiles',
          minzoom: 0,
          maxzoom: 22
        }]
      },
      center: [selectedLocation.lng, selectedLocation.lat],
      zoom: 14
    });
    
    liveTrackingMap.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    // Add current location button
    const locationControl = document.createElement('div');
    locationControl.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    locationControl.innerHTML = `
      <button class="maplibre-style-btn" onclick="centerOnCurrentLocation()" title="My Location">
        <i class="bi bi-crosshair"></i> My Location
      </button>
    `;
    liveTrackingMap.addControl({ onAdd: () => locationControl, onRemove: () => {} }, 'top-left');
    
    // Add style switcher
    const styleControl = document.createElement('div');
    styleControl.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    styleControl.innerHTML = `
      <button class="maplibre-style-btn" onclick="switchLiveMapStyle('gta')" title="GTA V Dark">
        <i class="bi bi-moon-stars-fill"></i>
      </button>
      <button class="maplibre-style-btn" onclick="switchLiveMapStyle('street')" title="Street View">
        <i class="bi bi-map"></i>
      </button>
      <button class="maplibre-style-btn" onclick="switchLiveMapStyle('satellite')" title="Satellite View">
        <i class="bi bi-globe"></i>
      </button>
    `;
    liveTrackingMap.addControl({ onAdd: () => styleControl, onRemove: () => {} }, 'bottom-left');
  }
  
  loadTaskTrackingInfo(taskId);
}

async function loadTaskTrackingInfo(taskId) {
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}`, { headers: authHeaders() });
    const data = await res.json();
    const task = data.task;
    
    if (!task) return;
    
    const taskerRes = await fetch(`${API_URL}/users/${task.assignedTaskerId}`, { headers: authHeaders() });
    const taskerData = await taskerRes.json();
    const tasker = taskerData.user;
    
    const requesterRes = await fetch(`${API_URL}/users/${task.requesterId}`, { headers: authHeaders() });
    const requesterData = await requesterRes.json();
    const requester = requesterData.user;
    
    document.getElementById('tasker-info').innerHTML = `
      <div class="d-flex align-items-center gap-2 mb-2">
        <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center" style="width:40px;height:40px;">
          <i class="bi bi-person-fill"></i>
        </div>
        <div>
          <strong>${escapeHtml(tasker.name || 'Tasker')}</strong>
          <div class="small text-muted">${tasker.phone || tasker.email || ''}</div>
        </div>
      </div>
      <div class="small">
        <div><i class="bi bi-star-fill text-warning"></i> ${(tasker.ratingAvg || 0).toFixed(1)} (${tasker.ratingCount || 0} reviews)</div>
        <div><i class="bi bi-check-circle text-success"></i> ${tasker.phoneVerified ? 'Phone Verified' : ''} ${tasker.emailVerified ? 'Email Verified' : ''}</div>
        <div class="mt-2"><strong>Status:</strong> <span class="badge bg-success">En Route</span></div>
      </div>
    `;
    
    document.getElementById('task-info-tracking').innerHTML = `
      <div><strong>${escapeHtml(task.title)}</strong></div>
      <div class="small text-muted">${escapeHtml(task.description || '')}</div>
      <div class="mt-2">
        <div><i class="bi bi-cash"></i> ${NPR(task.price)}</div>
        <div><i class="bi bi-clock"></i> ${task.durationMin || 0} minutes</div>
        <div><i class="bi bi-person"></i> Requester: ${escapeHtml(requester.name || 'Client')}</div>
      </div>
      <div class="mt-2">
        <div class="progress" style="height: 5px;">
          <div class="progress-bar bg-success" style="width: ${task.status === 'in_progress' ? '50%' : '25%'}"></div>
        </div>
        <small class="text-muted">Task ${task.status}</small>
      </div>
    `;
    
    if (task.location && task.location.coordinates) {
      const [lng, lat] = task.location.coordinates;
      
      if (!requesterMarkerLive) {
        requesterMarkerLive = new maplibregl.Marker({ color: '#10b981' })
          .setLngLat([lng, lat])
          .setPopup(new maplibregl.Popup().setHTML('<strong>Task Location</strong>'))
          .addTo(liveTrackingMap);
      }
      
      liveTrackingMap.setCenter([lng, lat]);
    }
    
    listenForLocationUpdates(taskId);
    
  } catch (e) {
    console.error('Failed to load tracking info:', e);
  }
}

let lastPosition = null;

function startLocationSharing(taskId) {
  if (locationUpdateInterval) clearInterval(locationUpdateInterval);
  
  if (navigator.geolocation) {
    locationUpdateInterval = setInterval(() => {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude, heading } = pos.coords;
        
        // Calculate heading from movement if not provided by device
        let calculatedHeading = heading;
        if (lastPosition && (!heading || heading === null)) {
          const dLng = longitude - lastPosition.lng;
          const dLat = latitude - lastPosition.lat;
          calculatedHeading = Math.atan2(dLng, dLat) * (180 / Math.PI);
        }
        
        if (socket && socket.connected) {
          socket.emit('location_update', {
            taskId,
            lat: latitude,
            lng: longitude,
            heading: calculatedHeading
          });
        }
        
        lastPosition = { lat: latitude, lng: longitude };
      }, (err) => {
        console.warn('Location error:', err.message);
      }, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
      });
    }, 3000);
  }
}

window.centerOnCurrentLocation = function() {
  if (!liveTrackingMap) return;
  
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      liveTrackingMap.flyTo({
        center: [longitude, latitude],
        zoom: 16,
        duration: 1000
      });
      
      // Add a temporary pulse marker
      const pulseEl = document.createElement('div');
      pulseEl.className = 'current-location-pulse';
      pulseEl.style.cssText = `
        width: 20px;
        height: 20px;
        background: #3b82f6;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
        animation: pulse 2s infinite;
      `;
      
      const tempMarker = new maplibregl.Marker({ element: pulseEl })
        .setLngLat([longitude, latitude])
        .addTo(liveTrackingMap);
      
      setTimeout(() => tempMarker.remove(), 3000);
    }, (err) => {
      showToast('Unable to get your location', 'danger');
    });
  } else {
    showToast('Geolocation not supported', 'danger');
  }
};

function listenForLocationUpdates(taskId) {
  if (!socket) return;
  
  socket.off('tasker_location');
  socket.on('tasker_location', (data) => {
    if (data.taskId !== taskId) return;
    
    const { lat, lng, heading } = data;
    
    // Create custom arrow marker for tasker
    if (!taskerMarkerLive) {
      const el = document.createElement('div');
      el.className = 'tasker-marker-arrow';
      el.innerHTML = `
        <div style="
          width: 40px;
          height: 40px;
          background: #dc2626;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          border: 3px solid white;
          transform: rotate(${heading || 0}deg);
        ">
          <i class="bi bi-arrow-up-short" style="color: white; font-size: 24px; font-weight: bold;"></i>
        </div>
      `;
      
      taskerMarkerLive = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(new maplibregl.Popup().setHTML('<strong>Tasker Location</strong><br><small>Live</small>'))
        .addTo(liveTrackingMap);
    } else {
      taskerMarkerLive.setLngLat([lng, lat]);
      
      // Update arrow rotation based on heading
      if (heading !== undefined) {
        const markerEl = taskerMarkerLive.getElement().querySelector('div');
        if (markerEl) {
          markerEl.style.transform = `rotate(${heading}deg)`;
        }
      }
    }
    
    if (requesterMarkerLive) {
      const taskerPos = taskerMarkerLive.getLngLat();
      const requesterPos = requesterMarkerLive.getLngLat();
      
      if (liveTrackingMap.getSource('route')) {
        liveTrackingMap.getSource('route').setData({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[taskerPos.lng, taskerPos.lat], [requesterPos.lng, requesterPos.lat]]
          }
        });
      } else {
        liveTrackingMap.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[taskerPos.lng, taskerPos.lat], [requesterPos.lng, requesterPos.lat]]
            }
          }
        });
        
        // Add animated route line
        liveTrackingMap.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#3b82f6',
            'line-width': 4,
            'line-opacity': 0.8
          }
        });
        
        // Add animated dashed line on top
        liveTrackingMap.addLayer({
          id: 'route-dashed',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#ffffff',
            'line-width': 2,
            'line-dasharray': [2, 4],
            'line-opacity': 0.9
          }
        });
      }
      
      const bounds = new maplibregl.LngLatBounds()
        .extend([taskerPos.lng, taskerPos.lat])
        .extend([requesterPos.lng, requesterPos.lat]);
      
      liveTrackingMap.fitBounds(bounds, { padding: 100 });
      
      const distance = calculateDistance(taskerPos.lat, taskerPos.lng, requesterPos.lat, requesterPos.lng);
      const eta = Math.round(distance / 0.5);
      
      showToast(`Tasker is ${distance.toFixed(2)} km away (ETA: ${eta} min)`, 'info', 3000);
    }
  });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

window.switchLiveMapStyle = function(style) {
  if (!liveTrackingMap) return;
  
  const styles = {
    gta: {
      version: 8,
      sources: {
        'dark-tiles': {
          type: 'raster',
          tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© CartoDB'
        }
      },
      layers: [{
        id: 'dark-tiles',
        type: 'raster',
        source: 'dark-tiles',
        minzoom: 0,
        maxzoom: 22
      }]
    },
    street: 'https://tiles.openfreemap.org/styles/liberty',
    satellite: {
      version: 8,
      sources: {
        'satellite': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256
        }
      },
      layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }]
    }
  };
  
  const center = liveTrackingMap.getCenter();
  const zoom = liveTrackingMap.getZoom();
  
  liveTrackingMap.setStyle(styles[style]);
  
  liveTrackingMap.once('styledata', () => {
    liveTrackingMap.setCenter(center);
    liveTrackingMap.setZoom(zoom);
    
    if (taskerMarkerLive) taskerMarkerLive.addTo(liveTrackingMap);
    if (requesterMarkerLive) requesterMarkerLive.addTo(liveTrackingMap);
    if (routeLine && liveTrackingMap.getSource('route')) {
      // Re-add route line after style change
      const coords = routeLine;
      liveTrackingMap.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        }
      });
      liveTrackingMap.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#3b82f6',
          'line-width': 4,
          'line-opacity': 0.8
        }
      });
    }
  });
};

document.getElementById('liveTrackingModal')?.addEventListener('hidden.bs.modal', () => {
  if (locationUpdateInterval) {
    clearInterval(locationUpdateInterval);
    locationUpdateInterval = null;
  }
  if (socket) socket.off('tasker_location');
});

// Map style switcher
window.switchMapStyle = function(mapType, style) {
  const targetMap = mapType === 'map' ? map : taskerMap;
  const targetMarker = mapType === 'map' ? marker : taskerMarker;
  
  if (!targetMap) return;
  
  const styles = {
    gta: {
      version: 8,
      sources: {
        'dark-tiles': {
          type: 'raster',
          tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© CartoDB'
        }
      },
      layers: [{
        id: 'dark-tiles',
        type: 'raster',
        source: 'dark-tiles',
        minzoom: 0,
        maxzoom: 22
      }]
    },
    street: 'https://tiles.openfreemap.org/styles/liberty',
    satellite: {
      version: 8,
      sources: {
        'satellite': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: '© Esri'
        }
      },
      layers: [{
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        minzoom: 0,
        maxzoom: 22
      }]
    }
  };
  
  const center = targetMap.getCenter();
  const zoom = targetMap.getZoom();
  const markerPos = targetMarker.getLngLat();
  
  targetMap.setStyle(styles[style]);
  
  targetMap.once('styledata', () => {
    targetMap.setCenter(center);
    targetMap.setZoom(zoom);
    targetMarker.setLngLat(markerPos);
  });
};

