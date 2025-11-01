// TaskNow Frontend Logic
const API_URL = window.location.origin;
const NPR = (paisa) => `NPR ${(Number(paisa || 0) / 100).toLocaleString()}`;

// Initialize token from cookie (will be set by auth-utils.js)
let token = null;
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

// Initialize GalliMaps Service
const galliMapsService = new GalliMapsService('e63a1458-7833-4b82-b946-19e4ef1f1138');
let mapId = null;
let markerId = null;
let taskerMapId = null;
let taskerMarkerId = null;
let taskerCircleId = null;

// Set up GalliMaps error and network event listeners
window.addEventListener('gallimaps:error', (event) => {
  const { message, level, context } = event.detail;

  // Only show user-facing errors
  if (level === 'error' && context && !context.includes('info')) {
    // Don't show duplicate toasts for the same error
    const errorKey = `${context}-${message}`;
    if (!window._lastGalliMapsError || window._lastGalliMapsError !== errorKey) {
      window._lastGalliMapsError = errorKey;
      setTimeout(() => {
        window._lastGalliMapsError = null;
      }, 5000);
    }
  }
});

window.addEventListener('gallimaps:network', (event) => {
  const { isOnline } = event.detail;

  if (isOnline) {
    showToast('Connection restored', 'success', 3000);
  } else {
    showToast('Connection lost. Retrying...', 'warning', 5000);
  }
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  // Initialize token and user from cookie
  token = window.authUtils ? window.authUtils.initAuth() : localStorage.getItem('token');
  
  // Try to load user from cookie first
  if (window.authUtils) {
    const cachedUser = window.authUtils.getUser();
    if (cachedUser) {
      currentUser = cachedUser;
      isOnline = !!currentUser.isOnline;
    }
  }
  
  // Check if GalliMaps library is loaded
  checkGalliMapsLibrary();

  if (token) loadUser();
  
  // Try to attach modal handlers (will retry when modals are loaded)
  attachModalHandlers();
  
  loadCategories();
  attachRadiusListener();
});

// Listen for modals loaded event and re-attach handlers
window.addEventListener('modalsLoaded', () => {
  console.log('[App] Modals loaded, attaching handlers...');
  attachModalHandlers();
  attachTaskFormHandler();
});

// Check GalliMaps library load status
function checkGalliMapsLibrary() {
  let checkAttempts = 0;
  const maxAttempts = 10;

  const checkInterval = setInterval(() => {
    checkAttempts++;

    if (typeof GalliMapPlugin !== 'undefined') {
      clearInterval(checkInterval);
      console.log('[GalliMaps] Library loaded successfully');
      return;
    }

    if (checkAttempts >= maxAttempts) {
      clearInterval(checkInterval);
      console.error('[GalliMaps] Library failed to load after', maxAttempts, 'attempts');

      // Show error message to user
      showToast('Unable to load maps. Please refresh the page.', 'danger', 10000);

      // Add a reload button to the page
      const container = document.getElementById('app-container');
      if (container) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show m-3';
        alert.innerHTML = `
          <strong><i class="bi bi-exclamation-triangle"></i> Map Service Unavailable</strong>
          <p class="mb-2">Unable to load the mapping service. This may be due to:</p>
          <ul class="mb-2">
            <li>Network connectivity issues</li>
            <li>Browser extensions blocking scripts</li>
            <li>Firewall or security settings</li>
          </ul>
          <button class="btn btn-sm btn-danger" onclick="location.reload()">
            <i class="bi bi-arrow-clockwise"></i> Reload Page
          </button>
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        container.prepend(alert);
      }
    }
  }, 500);
}

function attachRadiusListener() {
  const radiusInput = document.getElementById('tasker-radius');
  if (radiusInput) {
    radiusInput.addEventListener('input', (e) => {
      const newRadius = Math.max(1, Math.min(50, Number(e.target.value) || 5));
      taskerSearchRadiusKm = newRadius;

      // Update circle if map is initialized
      if (taskerMapId && taskerMarkerId) {
        try {
          const markers = galliMapsService.markers.get(taskerMapId);
          const markerData = markers.get(taskerMarkerId);

          if (markerData && markerData.latLng) {
            updateTaskerCircle(markerData.latLng[0], markerData.latLng[1], newRadius);
          }
        } catch (error) {
          console.error('Failed to update circle on radius change:', error);
        }
      }
    });
  }
}

function attachModalHandlers() {
  const postTaskModal = document.getElementById('postTaskModal');
  if (postTaskModal) {
    console.log('[Map] Attaching handler to postTaskModal');
    postTaskModal.addEventListener('shown.bs.modal', () => {
      console.log('[Map] Post task modal shown, initializing map...');
      setTimeout(() => initMap(), 200);
      
      // Add price input listener for professional mode
      const priceInput = document.getElementById('task-price');
      if (priceInput) {
        priceInput.addEventListener('input', updateProfessionalPrice);
      }
    });
  } else {
    console.warn('[Map] postTaskModal not found');
  }
  
  const setLocModal = document.getElementById('setLocationModal');
  if (setLocModal) {
    console.log('[Map] Attaching handler to setLocationModal');
    setLocModal.addEventListener('shown.bs.modal', () => {
      console.log('[Map] Set location modal shown, initializing map...');
      setTimeout(() => initTaskerMapDirect(), 500);
    });
  } else {
    console.warn('[Map] setLocationModal not found');
  }
}

// Expose function globally for load-modals.js
window.attachModalHandlers = attachModalHandlers;

// Landing helpers - removed, now using separate pages

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
      token = data.token;
      currentUser = data.user;
      
      // Save token and user to cookie and localStorage
      if (window.authUtils) {
        window.authUtils.saveToken(token);
        window.authUtils.saveUser(currentUser);
      } else {
        localStorage.setItem('token', token);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
      }
      
      if (!currentUser.name) {
        document.getElementById('otp-step').classList.add('hidden');
        document.getElementById('profile-step').classList.remove('hidden');
      } else {
        const modal = bootstrap.Modal.getInstance(document.getElementById('loginModal'));
        if (modal) modal.hide();
        
        // Redirect to home page
        window.location.href = '/';
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
      const modal = bootstrap.Modal.getInstance(document.getElementById('loginModal'));
      if (modal) modal.hide();
      
      // Redirect to home page
      window.location.href = '/';
    }
  } catch (e) { showToast(e.message, 'danger'); }
}

async function loadUser() {
  try {
    const res = await fetch(`${API_URL}/auth/me`, { headers: authHeaders() });
    if (!res.ok) { return logout(); }
    const data = await res.json();
    
    // Save user data to cookie
    if (window.authUtils) {
      window.authUtils.saveUser(data.user);
    } else {
      localStorage.setItem('currentUser', JSON.stringify(data.user));
    }
    
    // If on landing/login page and logged in, redirect to home
    const isLoginPage = window.location.pathname === '/index.html';
    if (isLoginPage) {
      window.location.href = '/';
      return;
    }
    
    enterApp(data.user);
  } catch (e) { logout(); }
}

function enterApp(user) {
  currentUser = user || currentUser;
  isOnline = !!currentUser?.isOnline;
  
  // Update user name in navbar (works on all pages)
  const uname = document.getElementById('user-name'); 
  if (uname) uname.textContent = (currentUser?.name || currentUser?.phone || 'User');
  
  updateOnlineToggle();
  connectSocket();
  loadCategories();
}

// Mobile helpers - removed, now using direct page navigation

function logout() {
  token = null; 
  currentUser = null;
  
  // Clear token from cookie and localStorage
  if (window.authUtils) {
    window.authUtils.clearToken();
  } else {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
  }
  
  if (socket) socket.disconnect();
  
  // Redirect to home page (will show landing)
  window.location.href = '/';
}

function authHeaders(extra = {}) { return { 'Authorization': `Bearer ${token}`, ...extra }; }

// Socket
function connectSocket() {
  if (socket) { socket.disconnect(); }
  socket = io(API_URL);
  socket.on('connect', () => {
    // Join rooms with user ID for targeted notifications
    if (currentUser && currentUser._id) {
      socket.emit('join_tasker', currentUser._id);
      socket.emit('join_requester', currentUser._id);
      console.log('[Socket] Joined rooms with userId:', currentUser._id);
    } else {
      socket.emit('join_tasker');
      socket.emit('join_requester');
      console.log('[Socket] Joined rooms without userId');
    }
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
  
  // Application system events
  socket.on('new_application', (data) => {
    loadMyTasks(); // Reload to update application count
    showToast(`New application for "${data.taskTitle}"`, 'info');
    playBeep();
  });
  socket.on('application_approved', (data) => {
    loadMyAcceptedTasks();
    showToast(`Your application for "${data.taskTitle}" was approved!`, 'success');
    playBeep();
  });
  socket.on('application_rejected', (data) => {
    showToast(`Your application for "${data.taskTitle}" was not selected`, 'warning');
  });
}

function playBeep() {
  try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.05; o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 150); } catch { }
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

// Map using GalliMaps
function initMap() {
  if (!galliMapsService.isLoaded()) {
    console.warn('GalliMaps not loaded yet, retrying...');

    // Retry up to 5 times
    if (!window._mapInitRetries) window._mapInitRetries = 0;
    window._mapInitRetries++;

    if (window._mapInitRetries < 5) {
      setTimeout(initMap, 500);
    } else {
      showToast('Unable to load maps. Please refresh the page.', 'danger');
      window._mapInitRetries = 0;
    }
    return;
  }

  const mapEl = document.getElementById('map');
  if (!mapEl) {
    console.warn('map container not found');
    return;
  }

  // Check if container is visible and has dimensions
  if (mapEl.offsetWidth === 0 || mapEl.offsetHeight === 0) {
    console.warn('map container not visible yet, retrying...');
    setTimeout(initMap, 200);
    return;
  }

  if (!mapId) {
    try {
      // Initialize GalliMaps
      mapId = galliMapsService.initializeMap({
        containerId: 'map',
        center: [selectedLocation.lat, selectedLocation.lng],
        zoom: 13,
        clickable: true,
        onLoad: () => {
          console.log('GalliMaps loaded for task posting');
          window._mapInitRetries = 0; // Reset retry counter on success

          // Add zoom controls after map loads
          try {
            galliMapsService.addZoomControls(mapId, 'top-right');
          } catch (error) {
            console.error('Failed to add zoom controls:', error);
          }
        },
        onError: (error) => {
          console.error('GalliMaps initialization error:', error);
          const userMessage = galliMapsService.handleError(error, 'initialization');
          showToast(userMessage, 'danger');

          // Reset map ID to allow retry
          mapId = null;
        }
      });

      // Add draggable marker
      markerId = galliMapsService.addMarker(mapId, {
        latLng: [selectedLocation.lat, selectedLocation.lng],
        color: '#dc2626',
        draggable: true,
        onDragEnd: (newLatLng) => {
          selectedLocation = { lat: newLatLng[0], lng: newLatLng[1] };
          updateLocationDisplay();
        }
      });

      // Add click listener to update marker position
      galliMapsService.addClickListener(mapId, (latLng) => {
        selectedLocation = { lat: latLng.lat, lng: latLng.lng };
        galliMapsService.updateMarkerPosition(mapId, markerId, [latLng.lat, latLng.lng]);
        updateLocationDisplay();
      });

      // Initialize autocomplete search
      initMapAutocomplete();

    } catch (error) {
      console.error('Failed to initialize map:', error);
      const userMessage = galliMapsService.handleError(error, 'map initialization');
      showToast(userMessage, 'danger');

      // Reset map ID to allow retry
      mapId = null;
    }
  }
  setTimeout(() => { updateLocationDisplay(); }, 100);
}

function updateLocationDisplay() {
  const latEl = document.getElementById('selected-lat');
  const lngEl = document.getElementById('selected-lng');
  if (latEl && lngEl) {
    latEl.textContent = selectedLocation.lat.toFixed(4);
    lngEl.textContent = selectedLocation.lng.toFixed(4);
  }
}

// Autocomplete search functionality
let searchDebounceTimer = null;
let currentSearchResults = [];

function initMapAutocomplete() {
  const searchInput = document.getElementById('map-location-search');
  if (!searchInput) return;

  const dropdown = document.getElementById('map-search-dropdown');
  if (!dropdown) return;

  // Add input event listener with debounce
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();

    // Clear previous timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }

    // Hide dropdown if query is too short
    if (query.length < 4) {
      dropdown.classList.add('hidden');
      currentSearchResults = [];
      return;
    }

    // Show loading state
    dropdown.innerHTML = '<div class="p-2 text-muted small"><i class="bi bi-hourglass-split"></i> Searching...</div>';
    dropdown.classList.remove('hidden');

    // Debounce search - wait 300ms after user stops typing
    searchDebounceTimer = setTimeout(() => {
      performAutocompleteSearch(query);
    }, 300);
  });

  // Hide dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Show dropdown when focusing on input with existing results
  searchInput.addEventListener('focus', () => {
    if (currentSearchResults.length > 0) {
      dropdown.classList.remove('hidden');
    }
  });
}

async function performAutocompleteSearch(query) {
  const dropdown = document.getElementById('map-search-dropdown');
  if (!dropdown) return;

  try {
    // Call GalliMaps autocomplete API
    const results = await galliMapsService.autoCompleteSearch(query);

    currentSearchResults = results;

    if (!results || results.length === 0) {
      dropdown.innerHTML = '<div class="p-2 text-muted small"><i class="bi bi-info-circle"></i> No locations found</div>';
      return;
    }

    // Display results in dropdown
    dropdown.innerHTML = results.map((result, index) => `
      <div class="search-result-item p-2 border-bottom" data-index="${index}" style="cursor: pointer;">
        <div class="fw-semibold small"><i class="bi bi-geo-alt-fill text-danger"></i> ${escapeHtml(result.name)}</div>
        <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(result.address || '')}</div>
      </div>
    `).join('');

    // Add click handlers to results
    dropdown.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        selectSearchResult(results[index]);
      });

      // Add hover effect
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#f8f9fa';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = '';
      });
    });

  } catch (error) {
    console.error('Autocomplete search failed:', error);
    dropdown.innerHTML = `<div class="p-2 text-danger small"><i class="bi bi-exclamation-triangle"></i> Search failed. Please try again.</div>`;
    showToast('Location search failed', 'danger');
  }
}

async function selectSearchResult(result) {
  const searchInput = document.getElementById('map-location-search');
  const dropdown = document.getElementById('map-search-dropdown');

  if (!result || !result.coordinates) {
    showToast('Invalid location data', 'danger');
    return;
  }

  try {
    // Update search input with selected location name
    if (searchInput) {
      searchInput.value = result.name;
    }

    // Hide dropdown
    if (dropdown) {
      dropdown.classList.add('hidden');
    }

    // Get detailed location data using searchLocation API
    const locationData = await galliMapsService.searchLocation(result);

    const lat = locationData.coordinates.lat;
    const lng = locationData.coordinates.lng;

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng)) {
      throw new Error('Invalid coordinates received');
    }

    // Update selected location
    selectedLocation = { lat, lng };

    // Update marker position
    if (mapId && markerId) {
      galliMapsService.updateMarkerPosition(mapId, markerId, [lat, lng]);

      // Center map on selected location with animation
      galliMapsService.setCenter(mapId, [lat, lng], 15, true);
    }

    // Update location display
    updateLocationDisplay();

    showToast(`Location set to ${result.name}`, 'success', 3000);

  } catch (error) {
    console.error('Failed to select location:', error);
    showToast('Failed to set location. Please try again.', 'danger');
  }
}

// Clear search input
function clearMapSearch() {
  const searchInput = document.getElementById('map-location-search');
  const dropdown = document.getElementById('map-search-dropdown');

  if (searchInput) {
    searchInput.value = '';
  }

  if (dropdown) {
    dropdown.classList.add('hidden');
  }

  currentSearchResults = [];
}

// Tasker map autocomplete functionality
let taskerSearchDebounceTimer = null;
let currentTaskerSearchResults = [];

function initTaskerMapAutocomplete() {
  const searchInput = document.getElementById('tasker-location-search');
  if (!searchInput) return;

  const dropdown = document.getElementById('tasker-search-dropdown');
  if (!dropdown) return;

  // Add input event listener with debounce
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();

    // Clear previous timer
    if (taskerSearchDebounceTimer) {
      clearTimeout(taskerSearchDebounceTimer);
    }

    // Hide dropdown if query is too short
    if (query.length < 4) {
      dropdown.classList.add('hidden');
      currentTaskerSearchResults = [];
      return;
    }

    // Show loading state
    dropdown.innerHTML = '<div class="p-2 text-muted small"><i class="bi bi-hourglass-split"></i> Searching...</div>';
    dropdown.classList.remove('hidden');

    // Debounce search - wait 300ms after user stops typing
    taskerSearchDebounceTimer = setTimeout(() => {
      performTaskerAutocompleteSearch(query);
    }, 300);
  });

  // Hide dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Show dropdown when focusing on input with existing results
  searchInput.addEventListener('focus', () => {
    if (currentTaskerSearchResults.length > 0) {
      dropdown.classList.remove('hidden');
    }
  });
}

async function performTaskerAutocompleteSearch(query) {
  const dropdown = document.getElementById('tasker-search-dropdown');
  if (!dropdown) return;

  try {
    // Call GalliMaps autocomplete API
    const results = await galliMapsService.autoCompleteSearch(query);

    currentTaskerSearchResults = results;

    if (!results || results.length === 0) {
      dropdown.innerHTML = '<div class="p-2 text-muted small"><i class="bi bi-info-circle"></i> No locations found</div>';
      return;
    }

    // Display results in dropdown
    dropdown.innerHTML = results.map((result, index) => `
      <div class="search-result-item p-2 border-bottom" data-index="${index}" style="cursor: pointer;">
        <div class="fw-semibold small"><i class="bi bi-geo-alt-fill text-danger"></i> ${escapeHtml(result.name)}</div>
        <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(result.address || '')}</div>
      </div>
    `).join('');

    // Add click handlers to results
    dropdown.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        selectTaskerSearchResult(results[index]);
      });

      // Add hover effect
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#f8f9fa';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = '';
      });
    });

  } catch (error) {
    console.error('Tasker autocomplete search failed:', error);
    dropdown.innerHTML = `<div class="p-2 text-danger small"><i class="bi bi-exclamation-triangle"></i> Search failed. Please try again.</div>`;
    showToast('Location search failed', 'danger');
  }
}

async function selectTaskerSearchResult(result) {
  const searchInput = document.getElementById('tasker-location-search');
  const dropdown = document.getElementById('tasker-search-dropdown');

  if (!result || !result.coordinates) {
    showToast('Invalid location data', 'danger');
    return;
  }

  try {
    // Update search input with selected location name
    if (searchInput) {
      searchInput.value = result.name;
    }

    // Hide dropdown
    if (dropdown) {
      dropdown.classList.add('hidden');
    }

    // Get detailed location data using searchLocation API
    const locationData = await galliMapsService.searchLocation(result);

    const lat = locationData.coordinates.lat;
    const lng = locationData.coordinates.lng;

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng)) {
      throw new Error('Invalid coordinates received');
    }

    // Update marker position
    if (taskerMapId && taskerMarkerId) {
      galliMapsService.updateMarkerPosition(taskerMapId, taskerMarkerId, [lat, lng]);

      // Center map on selected location with animation
      galliMapsService.setCenter(taskerMapId, [lat, lng], 15, true);

      // Update display
      updateTaskerMapDisplay(lat, lng);

      // Update circle
      updateTaskerCircle(lat, lng, taskerSearchRadiusKm);
    }

    showToast(`Location set to ${result.name}`, 'success', 3000);

  } catch (error) {
    console.error('Failed to select tasker location:', error);
    showToast('Failed to set location. Please try again.', 'danger');
  }
}

window.useCurrentLocation = function () {
  console.log('[Location] Getting current location...');
  
  if (!navigator.geolocation) {
    showToast('Geolocation not supported by your browser', 'danger');
    return;
  }

  showToast('Getting your location...', 'info', 2000);

  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    selectedLocation = { lat: latitude, lng: longitude };
    
    console.log('[Location] Got location:', latitude, longitude);

    if (mapId && markerId) {
      try {
        // Smooth pan to current location
        galliMapsService.setCenter(mapId, [latitude, longitude], 15, true);

        // Update marker position
        galliMapsService.updateMarkerPosition(mapId, markerId, [latitude, longitude]);
        updateLocationDisplay();

        showToast('Location set to your current position', 'success');
      } catch (error) {
        console.error('[Location] Failed to update map:', error);
        showToast('Failed to update map location', 'danger');
      }
    } else {
      console.warn('[Location] Map not initialized yet, but location saved');
      updateLocationDisplay();
      showToast('Location saved. Map will update when ready.', 'success');
    }
  }, (err) => {
    console.error('[Location] Geolocation error:', err);
    showToast('Unable to get your location: ' + err.message, 'danger');
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  });
};

window.useTaskerCurrentLocation = function () {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported by your browser', 'danger');
    return;
  }

  showToast('Getting your location...', 'info', 2000);

  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;

    if (taskerMapId && taskerMarkerId) {
      try {
        // Smooth pan to current location
        galliMapsService.setCenter(taskerMapId, [latitude, longitude], 15, true);

        // Update marker position
        galliMapsService.updateMarkerPosition(taskerMapId, taskerMarkerId, [latitude, longitude]);
        updateTaskerMapDisplay(latitude, longitude);

        showToast('Location set to your current position', 'success');
      } catch (error) {
        console.error('Failed to update tasker location:', error);
        showToast('Failed to update map location', 'danger');
      }
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

// Direct initialization without service wrapper (for modal)
function initTaskerMapDirect() {
  if (typeof GalliMapPlugin === 'undefined') {
    console.warn('GalliMapPlugin not loaded');
    setTimeout(initTaskerMapDirect, 500);
    return;
  }

  const mapEl = document.getElementById('tasker-map');
  if (!mapEl || mapEl.offsetWidth === 0) {
    console.warn('tasker-map not ready');
    setTimeout(initTaskerMapDirect, 200);
    return;
  }

  if (taskerMap) {
    console.log('Tasker map already initialized');
    return;
  }

  try {
    const def = taskerLocation || selectedLocation || { lat: 27.7172, lng: 85.3240 };

    const galliMapsObject = {
      accessToken: 'e63a1458-7833-4b82-b946-19e4ef1f1138',
      map: {
        container: 'tasker-map',
        center: [def.lat, def.lng],
        zoom: 13,
        maxZoom: 25,
        minZoom: 5,
        clickable: true
      },
      customClickFunctions: [(event) => {
        const lat = event.lngLat.lat;
        const lng = event.lngLat.lng;

        // Remove old marker
        if (taskerMarker) {
          try { taskerMap.removePinMarker(taskerMarker); } catch (e) { }
        }

        // Add new marker
        taskerMarker = taskerMap.displayPinMarker({
          color: "#dc2626",
          draggable: true,
          latLng: [lat, lng]
        });

        updateTaskerMapDisplay(lat, lng);
      }]
    };

    taskerMap = new GalliMapPlugin(galliMapsObject);

    // Add initial marker
    taskerMarker = taskerMap.displayPinMarker({
      color: "#dc2626",
      draggable: true,
      latLng: [def.lat, def.lng]
    });

    updateTaskerMapDisplay(def.lat, def.lng);
    document.getElementById('tasker-radius').value = taskerSearchRadiusKm;

    console.log('Tasker map initialized successfully (direct)');
  } catch (error) {
    console.error('Failed to initialize tasker map:', error);
    showToast('Map initialization failed', 'warning');
  }
}

function initTaskerMap() {
  if (!galliMapsService.isLoaded()) {
    console.warn('GalliMaps not loaded yet, retrying...');

    // Retry up to 5 times
    if (!window._taskerMapInitRetries) window._taskerMapInitRetries = 0;
    window._taskerMapInitRetries++;

    if (window._taskerMapInitRetries < 5) {
      setTimeout(initTaskerMap, 500);
    } else {
      showToast('Unable to load maps. Please refresh the page.', 'danger');
      window._taskerMapInitRetries = 0;
    }
    return;
  }

  const def = taskerLocation || selectedLocation || { lat: 27.7172, lng: 85.3240 };
  const mapEl = document.getElementById('tasker-map');
  if (!mapEl) {
    console.warn('tasker-map container not found');
    return;
  }

  // Check if container is visible and has dimensions
  if (mapEl.offsetWidth === 0 || mapEl.offsetHeight === 0) {
    console.warn('tasker-map container not visible yet, retrying...');
    setTimeout(initTaskerMap, 200);
    return;
  }

  if (!taskerMapId) {
    try {
      // Initialize GalliMaps for tasker
      taskerMapId = galliMapsService.initializeMap({
        containerId: 'tasker-map',
        center: [def.lat, def.lng],
        zoom: 13,
        clickable: true,
        onLoad: () => {
          console.log('GalliMaps loaded for tasker location');
          window._taskerMapInitRetries = 0; // Reset retry counter on success

          // Add zoom controls after map loads
          try {
            galliMapsService.addZoomControls(taskerMapId, 'top-right');
          } catch (error) {
            console.error('Failed to add zoom controls:', error);
          }
          // Add circle overlay after map loads
          updateTaskerCircle(def.lat, def.lng, taskerSearchRadiusKm);
        },
        onError: (error) => {
          console.error('GalliMaps initialization error:', error);
          const userMessage = galliMapsService.handleError(error, 'initialization');
          showToast(userMessage, 'danger');

          // Reset map ID to allow retry
          taskerMapId = null;
        }
      });

      // Add draggable marker
      taskerMarkerId = galliMapsService.addMarker(taskerMapId, {
        latLng: [def.lat, def.lng],
        color: '#dc2626',
        draggable: true,
        onDragEnd: (newLatLng) => {
          updateTaskerMapDisplay(newLatLng[0], newLatLng[1]);
          updateTaskerCircle(newLatLng[0], newLatLng[1], taskerSearchRadiusKm);
        }
      });

      // Add click listener to update marker position
      galliMapsService.addClickListener(taskerMapId, (latLng) => {
        galliMapsService.updateMarkerPosition(taskerMapId, taskerMarkerId, [latLng.lat, latLng.lng]);
        updateTaskerMapDisplay(latLng.lat, latLng.lng);
        updateTaskerCircle(latLng.lat, latLng.lng, taskerSearchRadiusKm);
      });

      // Initialize autocomplete search for tasker map
      initTaskerMapAutocomplete();

    } catch (error) {
      console.error('Failed to initialize tasker map:', error);
      const userMessage = galliMapsService.handleError(error, 'tasker map initialization');
      showToast(userMessage, 'danger');

      // Reset map ID to allow retry
      taskerMapId = null;
    }
  } else {
    // Update existing map
    try {
      galliMapsService.setCenter(taskerMapId, [def.lat, def.lng], 13, false);
      galliMapsService.updateMarkerPosition(taskerMapId, taskerMarkerId, [def.lat, def.lng]);
      updateTaskerCircle(def.lat, def.lng, taskerSearchRadiusKm);
    } catch (error) {
      console.error('Failed to update tasker map:', error);
      const userMessage = galliMapsService.handleError(error, 'tasker map update');
      showToast(userMessage, 'warning');
    }
  }
  document.getElementById('tasker-radius').value = taskerSearchRadiusKm;
  updateTaskerMapDisplay(def.lat, def.lng);
}

function updateTaskerCircle(lat, lng, radiusKm) {
  if (!taskerMapId) return;

  try {
    // Remove existing circle if present
    if (taskerCircleId) {
      galliMapsService.removeCircle(taskerMapId, taskerCircleId);
      taskerCircleId = null;
    }

    // Add new circle with updated radius
    taskerCircleId = galliMapsService.addCircle(taskerMapId, {
      center: [lat, lng],
      radiusKm: radiusKm,
      color: '#3b82f6',
      opacity: 0.15,
      strokeColor: '#2563eb',
      strokeWidth: 2
    });
  } catch (error) {
    console.error('Failed to update tasker circle:', error);
    // Circle functionality is optional, don't show error to user
  }
}

function updateTaskerMapDisplay(lat, lng) {
  document.getElementById('tasker-lat').textContent = Number(lat).toFixed(5);
  document.getElementById('tasker-lng').textContent = Number(lng).toFixed(5);
}

async function saveTaskerLocation() {
  if (!taskerMarkerId || !taskerMapId) return;

  try {
    // Get marker data from service
    const markers = galliMapsService.markers.get(taskerMapId);
    const markerData = markers.get(taskerMarkerId);

    if (markerData && markerData.latLng) {
      taskerLocation = { lat: markerData.latLng[0], lng: markerData.latLng[1] };
      taskerSearchRadiusKm = Math.max(1, Number(document.getElementById('tasker-radius').value) || 5);
      updateTaskerLocationInline();

      // Optionally persist to profile
      try {
        await fetch(`${API_URL}/auth/me`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ lat: taskerLocation.lat, lng: taskerLocation.lng })
        });
      } catch { }

      bootstrap.Modal.getInstance(document.getElementById('setLocationModal')).hide();
      showToast('Search location updated', 'success');
      loadNearbyTasks();
    }
  } catch (error) {
    console.error('Failed to save tasker location:', error);
    showToast('Failed to save location', 'danger');
  }
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
      const opt = document.createElement('option'); opt.value = cat._id; opt.textContent = `${cat.name} (NPR ${(cat.minPrice / 100).toLocaleString()}-${(cat.maxPrice / 100).toLocaleString()})`; select.appendChild(opt);
    });
    renderCategoriesList(data.categories || []);
  } catch { }
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
  container.innerHTML = categories.map(c => `<div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2"><div><strong>${escapeHtml(c.name)}</strong><div class="small text-muted">NPR ${(c.minPrice / 100).toLocaleString()} - ${(c.maxPrice / 100).toLocaleString()}</div></div><code class="small">${c._id}</code></div>`).join('');
}

// Post Task - attach handler after modals are loaded
function attachTaskFormHandler() {
  const createTaskForm = document.getElementById('create-task-form');
  if (!createTaskForm) {
    console.warn('[Form] create-task-form not found');
    return;
  }
  
  // Remove existing listener if any
  const newForm = createTaskForm.cloneNode(true);
  createTaskForm.parentNode.replaceChild(newForm, createTaskForm);
  
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('[Form] Submitting task...');
    
    const sel = document.getElementById('task-category').value;
    const basePrice = parseInt(document.getElementById('task-price').value, 10);
    const isProfessionalMode = document.getElementById('task-professional-mode').checked;
    const professionalBonus = isProfessionalMode ? 0.2 : 0; // 20% bonus
    const totalPrice = Math.round(basePrice * (1 + professionalBonus));
    
    const taskData = {
      title: document.getElementById('task-title').value,
      description: document.getElementById('task-description').value,
      categoryId: sel,
      categoryName: sel === 'custom' ? document.getElementById('task-category-custom').value : undefined,
      price: totalPrice * 100, // Convert to paisa
      durationMin: parseInt(document.getElementById('task-duration').value, 10) || 0,
      lat: selectedLocation.lat,
      lng: selectedLocation.lng,
      radiusKm: parseInt(document.getElementById('task-radius').value, 10),
      professionalOnly: isProfessionalMode,
      professionalBonus: professionalBonus
    };
    
    console.log('[Form] Task data:', taskData);
    
    if (sel === 'custom' && !taskData.categoryName) { 
      showToast('Please describe your custom category', 'warning'); 
      return; 
    }
    
    try {
      const res = await fetch(`${API_URL}/tasks`, { 
        method: 'POST', 
        headers: authHeaders({ 'Content-Type': 'application/json' }), 
        body: JSON.stringify(taskData) 
      });
      const data = await res.json();
      
      if (res.ok) {
        console.log('[Form] Task posted successfully:', data.taskId);
        bootstrap.Modal.getInstance(document.getElementById('postTaskModal')).hide();
        openDemoCheckout({ taskId: data.taskId, amount: taskData.price, title: taskData.title });
        newForm.reset();
        loadMyTasks();
      } else {
        console.error('[Form] Failed to post task:', data.error);
        showToast(data.error || 'Failed to post task', 'danger');
      }
    } catch (e) { 
      console.error('[Form] Error posting task:', e);
      showToast(e.message, 'danger'); 
    }
  });
  
  console.log('[Form] Task form handler attached');
}

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
    } catch { }
    bootstrap.Modal.getInstance(document.getElementById('demoCheckoutModal')).hide();
    showToast('Demo payment failed — task removed', 'danger');
    loadMyTasks();
  }

window.simulateCheckoutSuccess = simulateCheckoutSuccess;
window.simulateCheckoutFail = simulateCheckoutFail;
window.openDemoCheckout = openDemoCheckout;
window.attachTaskFormHandler = attachTaskFormHandler;

// Edit task UI
  let editingTaskId = null;
  function openEditTask(taskId) {
    editingTaskId = taskId;
    const t = (window._myTasksCache || []).find(x => x._id === taskId);
    if (t) {
      document.getElementById('edit-title').value = t.title || '';
      document.getElementById('edit-description').value = t.description || '';
      document.getElementById('edit-price').value = Math.round((t.price || 0) / 100);
      document.getElementById('edit-duration').value = t.durationMin || 0;
    }
    new bootstrap.Modal(document.getElementById('editTaskModal')).show();
  }
  async function saveEditTask() {
    if (!editingTaskId) return;
    const payload = {
      title: document.getElementById('edit-title').value,
      description: document.getElementById('edit-description').value,
      price: parseInt(document.getElementById('edit-price').value, 10) * 100,
      durationMin: parseInt(document.getElementById('edit-duration').value, 10) || 0
    };
    try {
      const res = await fetch(`${API_URL}/tasks/${editingTaskId}`, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) { showToast('Task updated', 'success'); loadMyTasks(); bootstrap.Modal.getInstance(document.getElementById('editTaskModal')).hide(); }
      else showToast(data.error || 'Failed to update', 'danger');
    } catch (e) { showToast(e.message, 'danger'); }
  }
window.openEditTask = openEditTask;
window.saveEditTask = saveEditTask;

// My Posted Tasks
async function loadMyTasks() {
  window._myTasksCache = [];
  if (!currentUser) {
    console.warn('[Tasks] Cannot load tasks - currentUser not set');
    return;
  }
  try {
    console.log('[Tasks] Loading tasks for user:', currentUser._id);
    const res = await fetch(`${API_URL}/users/${currentUser._id}/tasks/requested`, { headers: authHeaders() });
    if (!res.ok) {
      console.error('[Tasks] Failed to load tasks:', res.status);
      return;
    }
    const data = await res.json();
    window._myTasksCache = data.tasks || [];
    console.log('[Tasks] Loaded', window._myTasksCache.length, 'tasks');
    renderMyTasks(window._myTasksCache);
  } catch (e) {
    console.error('[Tasks] Error loading tasks:', e);
  }
}

function renderMyTasks(tasks) {
  const container = document.getElementById('my-tasks-list'); if (!container) return;
  if (!tasks.length) { return container.innerHTML = emptyState('No tasks yet', 'Post your first task to get help.'); }
  container.innerHTML = tasks.map(task => `
    <div class="task-card">
      <div class="d-flex justify-content-between align-items-start">
        <div class="flex-grow-1">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">
            <span class="badge badge-${task.status}">${task.status}</span>
            ${task.categoryName ? `<span class="badge bg-secondary ms-1">${escapeHtml(task.categoryName)}</span>` : ''}
          </div>
        </div>
        <div class="task-price">${NPR(task.price)}</div>
      </div>
      <div class="mt-2 d-flex gap-2 flex-wrap">
        ${task.status === 'posted' ? `<button class=\"btn btn-primary btn-sm\" onclick=\"viewApplicants('${task._id}')\"><i class=\"bi bi-people\"></i> Applicants ${task.applicationCount > 0 ? `<span class=\"badge bg-light text-dark\">${task.applicationCount}</span>` : ''}</button>` : ''}
        ${task.status === 'posted' ? `<button class=\"btn btn-outline-secondary btn-sm\" onclick=\"openEditTask('${task._id}')\">Edit</button>` : ''}
        ${task.status === 'posted' ? `<button class=\"btn btn-outline-danger btn-sm\" onclick=\"deleteTask('${task._id}')\">Delete</button>` : ''}
        ${['accepted', 'in_progress'].includes(task.status) ? `<button class="btn btn-danger btn-sm" onclick="openLiveTracking('${task._id}')"><i class="bi bi-broadcast"></i> Track Live</button>` : ''}
        ${['accepted', 'in_progress'].includes(task.status) ? `<button class="btn btn-outline-danger btn-sm" onclick="deleteTask('${task._id}')">Cancel</button>` : ''}
        ${task.status === 'completed' ? `<button class="btn btn-success btn-sm" onclick="approveTask('${task._id}')">Approve & Pay</button>` : ''}
        ${['accepted', 'in_progress', 'completed', 'paid'].includes(task.status) ? `<button class="btn btn-outline-primary btn-sm" onclick="openChat('${task._id}')">Chat</button>` : ''}
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
  } catch { }
}

function renderNearbyTasks(tasks) {
  const container = document.getElementById('nearby-tasks-list'); if (!container) return;
  if (!tasks.length) return container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-geo"></i></div><div class="empty-state-title">No tasks nearby</div><div class="empty-state-text">Try increasing your radius or come back later.</div></div>`;
  container.innerHTML = tasks.map(task => `
    <div class="task-card" style="cursor: pointer;" onclick="viewTaskDetails('${task._id}')">
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div class="flex-grow-1">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">${escapeHtml(task.description || 'No description')}</div>
          <div class="mt-1">
            ${task.categoryName ? `<span class="badge bg-secondary">${escapeHtml(task.categoryName)}</span>` : ''}
            ${task.professionalOnly ? `<span class="badge bg-warning text-dark"><i class="bi bi-award-fill"></i> Professional Only</span>` : ''}
          </div>
        </div>
        <div class="task-price">${NPR(task.price)}</div>
      </div>
      <div class="d-flex justify-content-between align-items-center text-muted small mb-2">
        <span><i class="bi bi-clock"></i> ${task.durationMin || 0} min</span>
        <span><i class="bi bi-geo-alt"></i> ${(task.radiusKm || 3)} km radius</span>
      </div>
      <div class="mt-2 d-flex gap-2">
        <button class="btn btn-outline-primary btn-sm" onclick="event.stopPropagation(); viewTaskDetails('${task._id}')">
          <i class="bi bi-eye"></i> View Details
        </button>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openApplyModal('${task._id}')">
          <i class="bi bi-send-check"></i> Apply
        </button>
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
          <div class="flex-grow-1">
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-meta">
              <span class="badge badge-${task.status}">${task.status}</span>
              ${task.categoryName ? `<span class="badge bg-secondary ms-1">${escapeHtml(task.categoryName)}</span>` : ''}
            </div>
          </div>
          <div class="task-price">${NPR(task.price)}</div>
        </div>
        <div class="mt-2 d-flex gap-2 flex-wrap">
          ${task.status === 'accepted' ? `<button class="btn btn-secondary btn-sm" onclick="startTask('${task._id}')">Start</button>` : ''}
          ${['accepted', 'in_progress'].includes(task.status) ? `<button class="btn btn-danger btn-sm" onclick="openLiveTracking('${task._id}')"><i class="bi bi-broadcast"></i> Share Location</button>` : ''}
          ${['accepted', 'in_progress'].includes(task.status) ? `<button class="btn btn-success btn-sm" onclick="showUploadProof('${task._id}')">Upload Proof</button>` : ''}
          ${['accepted', 'in_progress'].includes(task.status) ? `<button class="btn btn-outline-danger btn-sm" onclick="rejectTask('${task._id}')">Reject</button>` : ''}
          ${['accepted', 'in_progress', 'completed', 'paid'].includes(task.status) ? `<button class="btn btn-outline-primary btn-sm" onclick="openChat('${task._id}')">Chat</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch { }
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
  } catch { }
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
  if (!currentUser) {
    console.error('Cannot load stats: currentUser is not defined');
    showToast('Please log in to view stats', 'warning');
    return;
  }
  
  try {
    const mres = await fetch(`${API_URL}/users/${currentUser._id}/metrics`, { headers: authHeaders() });
    if (mres.ok) {
      const mdata = await mres.json();
      const m = mdata.metrics;
      document.getElementById('stat-posted-total').textContent = m.postedTotal || 0;
      document.getElementById('stat-tasker-earned').textContent = NPR(m.taskerEarned || 0);
      document.getElementById('stat-completed').textContent = m.taskerCompleted || 0;
      const feesEl = document.getElementById('stat-fees-pending'); 
      if (feesEl) feesEl.textContent = NPR((m.feesFromMyEarnings ?? 0) || (m.platformFeesPending ?? 0));
    } else {
      console.error('Failed to load stats:', mres.status, mres.statusText);
      showToast('Failed to load stats', 'danger');
    }
  } catch (e) {
    console.error('Error loading stats:', e);
    showToast('Error loading stats', 'danger');
  }
}

// Profile & Wallet - moved to profile.html page
async function showWallet() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_URL}/users/${currentUser._id}/wallet`, { headers: authHeaders() });
    const data = await res.json();
    alert(`Wallet Balance: NPR ${data.wallet.balance / 100}\nPending: NPR ${data.wallet.pending / 100}`);
  } catch { showToast('Failed to load wallet', 'danger'); }
}

// Utils
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c])); }
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
// Application System
let currentApplyTaskId = null;

async function openApplyModal(taskId) {
  try {
    currentApplyTaskId = taskId;
    
    // Fetch task details
    const res = await fetch(`${API_URL}/tasks/${taskId}`, { headers: authHeaders() });
    if (!res.ok) {
      showToast('Failed to load task details', 'danger');
      return;
    }
    
    const data = await res.json();
    const task = data.task;
    
    // Populate task info
    const taskInfo = document.getElementById('apply-task-info');
    if (taskInfo) {
      taskInfo.innerHTML = `
        <div class="card bg-light">
          <div class="card-body">
            <h6 class="card-title">${task.title}</h6>
            <p class="text-muted small mb-2">${task.description || 'No description'}</p>
            <div class="d-flex justify-content-between">
              <span class="text-muted">Posted Price:</span>
              <strong class="text-success">${NPR(task.price)}</strong>
            </div>
          </div>
        </div>
      `;
    }
    
    // Set default price
    document.getElementById('apply-proposed-price').value = task.price;
    document.getElementById('apply-message').value = '';
    
    // Character counter
    const messageInput = document.getElementById('apply-message');
    const counter = document.getElementById('apply-message-count');
    messageInput.addEventListener('input', () => {
      counter.textContent = messageInput.value.length;
    });
    
    // Open modal
    const modal = new bootstrap.Modal(document.getElementById('applyTaskModal'));
    modal.show();
    
  } catch (error) {
    console.error('Error opening apply modal:', error);
    showToast('Failed to open application form', 'danger');
  }
}

async function submitApplication() {
  if (!currentApplyTaskId) return;
  
  const proposedPrice = parseInt(document.getElementById('apply-proposed-price').value);
  const message = document.getElementById('apply-message').value.trim();
  
  if (!proposedPrice || proposedPrice <= 0) {
    showToast('Please enter a valid price', 'warning');
    return;
  }
  
  try {
    const res = await fetch(`${API_URL}/applications`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        taskId: currentApplyTaskId,
        proposedPrice,
        message
      })
    });
    
    if (res.ok) {
      showToast('Application submitted successfully!', 'success');
      bootstrap.Modal.getInstance(document.getElementById('applyTaskModal')).hide();
      currentApplyTaskId = null;
      
      // Reload tasks
      if (typeof loadAvailableTasks === 'function') loadAvailableTasks();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to submit application', 'danger');
    }
  } catch (error) {
    console.error('Error submitting application:', error);
    showToast('Failed to submit application', 'danger');
  }
}

async function viewApplicants(taskId) {
  try {
    const res = await fetch(`${API_URL}/applications/task/${taskId}`, { headers: authHeaders() });
    
    if (!res.ok) {
      showToast('Failed to load applicants', 'danger');
      return;
    }
    
    const data = await res.json();
    const applications = data.applications || [];
    
    const applicantsList = document.getElementById('applicants-list');
    
    if (applications.length === 0) {
      applicantsList.innerHTML = '<p class="text-center text-muted">No applicants yet</p>';
    } else {
      applicantsList.innerHTML = applications.map(app => {
        const applicant = app.applicant;
        const isPending = app.status === 'pending';
        const isApproved = app.status === 'approved';
        
        return `
          <div class="card mb-3 ${isApproved ? 'border-success' : ''}">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start mb-3">
                <div class="d-flex align-items-center gap-3">
                  <div class="profile-avatar" style="width: 50px; height: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 20px;">
                    ${(applicant.name || applicant.phone || 'T')[0].toUpperCase()}
                  </div>
                  <div>
                    <h6 class="mb-1">
                      ${applicant.name || 'Tasker'}
                      ${applicant.isProfessional ? '<i class="bi bi-patch-check-fill text-primary" title="Verified Professional"></i>' : ''}
                    </h6>
                    <div class="text-muted small">${applicant.phone || ''}</div>
                  </div>
                </div>
                ${isApproved ? '<span class="badge bg-success">Approved</span>' : ''}
                ${app.status === 'rejected' ? '<span class="badge bg-danger">Rejected</span>' : ''}
              </div>
              
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <div class="small text-muted">Rating as Tasker</div>
                  <div class="fw-semibold">
                    <i class="bi bi-star-fill text-warning"></i> ${(applicant.ratingAvgAsTasker || 0).toFixed(1)}
                    <span class="text-muted small">(${applicant.ratingCountAsTasker || 0})</span>
                  </div>
                </div>
                <div class="col-6">
                  <div class="small text-muted">Tasks Completed</div>
                  <div class="fw-semibold">${app.applicant.completedTasks || 0}</div>
                </div>
              </div>
              
              ${applicant.skills && applicant.skills.length > 0 ? `
                <div class="mb-3">
                  <div class="small text-muted mb-1">Skills</div>
                  <div class="d-flex flex-wrap gap-1">
                    ${applicant.skills.map(skill => `<span class="badge bg-info">${skill}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
              
              <div class="mb-3">
                <div class="small text-muted">Proposed Price</div>
                <div class="fw-semibold text-success">${NPR(app.proposedPrice)}</div>
              </div>
              
              ${app.message ? `
                <div class="mb-3">
                  <div class="small text-muted">Message</div>
                  <div class="small">"${app.message}"</div>
                </div>
              ` : ''}
              
              ${isPending ? `
                <div class="d-flex gap-2">
                  <button class="btn btn-success btn-sm flex-fill" onclick="approveApplication('${app._id}', '${taskId}')">
                    <i class="bi bi-check-circle"></i> Approve
                  </button>
                  <button class="btn btn-outline-danger btn-sm" onclick="rejectApplication('${app._id}', '${taskId}')">
                    <i class="bi bi-x-circle"></i> Reject
                  </button>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
    
    // Open modal
    const modal = new bootstrap.Modal(document.getElementById('viewApplicantsModal'));
    modal.show();
    
  } catch (error) {
    console.error('Error loading applicants:', error);
    showToast('Failed to load applicants', 'danger');
  }
}

async function approveApplication(applicationId, taskId) {
  if (!confirm('Approve this applicant? This will reject all other applications.')) return;
  
  try {
    const res = await fetch(`${API_URL}/applications/${applicationId}/approve`, {
      method: 'POST',
      headers: authHeaders()
    });
    
    if (res.ok) {
      showToast('Application approved!', 'success');
      bootstrap.Modal.getInstance(document.getElementById('viewApplicantsModal')).hide();
      
      // Reload tasks
      if (typeof loadMyTasks === 'function') loadMyTasks();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to approve', 'danger');
    }
  } catch (error) {
    console.error('Error approving application:', error);
    showToast('Failed to approve application', 'danger');
  }
}

async function rejectApplication(applicationId, taskId) {
  if (!confirm('Reject this application?')) return;
  
  try {
    const res = await fetch(`${API_URL}/applications/${applicationId}/reject`, {
      method: 'POST',
      headers: authHeaders()
    });
    
    if (res.ok) {
      showToast('Application rejected', 'info');
      // Reload applicants
      viewApplicants(taskId);
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to reject', 'danger');
    }
  } catch (error) {
    console.error('Error rejecting application:', error);
    showToast('Failed to reject application', 'danger');
  }
}

async function viewTaskDetails(taskId) {
  try {
    const res = await fetch(`${API_URL}/tasks/${taskId}`, { headers: authHeaders() });
    
    if (!res.ok) {
      showToast('Failed to load task details', 'danger');
      return;
    }
    
    const data = await res.json();
    const task = data.task;
    
    const content = document.getElementById('task-details-content');
    const footer = document.getElementById('task-details-footer');
    
    // Define these outside the if blocks so they're accessible in both
    const requester = task.requesterId;
    const isMyTask = currentUser && task.requesterId._id === currentUser._id;
    const isAssigned = currentUser && task.assignedTaskerId && task.assignedTaskerId._id === currentUser._id;
    
    if (content) {
      
      content.innerHTML = `
        <div class="mb-4">
          <h4 class="mb-2">${escapeHtml(task.title)}</h4>
          ${task.categoryName ? `<div class="mb-2"><span class="badge bg-secondary">${escapeHtml(task.categoryName)}</span></div>` : ''}
          <p class="text-muted">${escapeHtml(task.description || 'No description provided')}</p>
        </div>
        
        <div class="row g-3 mb-4">
          <div class="col-md-6">
            <div class="card bg-light">
              <div class="card-body">
                <h6 class="card-title text-muted mb-3">Task Details</h6>
                <div class="d-flex justify-content-between mb-2">
                  <span class="text-muted">Price:</span>
                  <strong class="text-success">${NPR(task.price)}</strong>
                </div>
                <div class="d-flex justify-content-between mb-2">
                  <span class="text-muted">Duration:</span>
                  <strong>${task.durationMin || 0} minutes</strong>
                </div>
                <div class="d-flex justify-content-between mb-2">
                  <span class="text-muted">Status:</span>
                  <span class="badge badge-${task.status}">${task.status}</span>
                </div>
                ${task.applicationCount > 0 ? `
                  <div class="d-flex justify-content-between">
                    <span class="text-muted">Applicants:</span>
                    <strong>${task.applicationCount}</strong>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
          
          <div class="col-md-6">
            <div class="card bg-light">
              <div class="card-body">
                <h6 class="card-title text-muted mb-3">Posted By</h6>
                <div class="d-flex align-items-center gap-2 mb-2">
                  <div class="profile-avatar" style="width: 40px; height: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                    ${(requester.name || requester.phone || 'U')[0].toUpperCase()}
                  </div>
                  <div>
                    <div class="fw-semibold">${requester.name || 'User'}</div>
                    <div class="text-muted small">${requester.phone || ''}</div>
                  </div>
                </div>
                <div class="d-flex justify-content-between">
                  <span class="text-muted">Rating as Customer:</span>
                  <span class="badge bg-primary">
                    <i class="bi bi-star-fill"></i> ${(requester.ratingAvgAsCustomer || 0).toFixed(1)}
                    <span class="small">(${requester.ratingCountAsCustomer || 0})</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="card bg-light mb-3">
          <div class="card-body">
            <h6 class="card-title text-muted mb-2">Location</h6>
            <div class="d-flex justify-content-between">
              <span class="text-muted">
                <i class="bi bi-geo-alt"></i> 
                ${task.location.coordinates[1].toFixed(4)}, ${task.location.coordinates[0].toFixed(4)}
              </span>
              <span class="text-muted">Radius: ${task.radiusKm || 3} km</span>
            </div>
          </div>
        </div>
      `;
    }
    
    if (footer) {
      if (isMyTask) {
        footer.innerHTML = `
          <button class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          <button class="btn btn-primary" onclick="viewApplicants('${task._id}')">
            <i class="bi bi-people"></i> View Applicants ${task.applicationCount > 0 ? `(${task.applicationCount})` : ''}
          </button>
        `;
      } else if (task.status === 'posted' && !isAssigned) {
        footer.innerHTML = `
          <button class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          <button class="btn btn-primary" onclick="openApplyModal('${task._id}')">
            <i class="bi bi-send-check"></i> Apply for this Task
          </button>
        `;
      } else {
        footer.innerHTML = `
          <button class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        `;
      }
    }
    
    // Open modal
    const modal = new bootstrap.Modal(document.getElementById('taskDetailsModal'));
    modal.show();
    
  } catch (error) {
    console.error('Error loading task details:', error);
    showToast('Failed to load task details', 'danger');
  }
}

// Professional Mode Price Calculator
function updateProfessionalPrice() {
  const priceInput = document.getElementById('task-price');
  const professionalMode = document.getElementById('task-professional-mode');
  const preview = document.getElementById('professional-price-preview');
  
  if (!priceInput || !professionalMode || !preview) return;
  
  const basePrice = parseInt(priceInput.value) || 0;
  const isEnabled = professionalMode.checked;
  
  if (isEnabled && basePrice > 0) {
    const bonus = Math.round(basePrice * 0.2);
    const total = basePrice + bonus;
    
    document.getElementById('base-price-display').textContent = NPR(basePrice * 100);
    document.getElementById('bonus-price-display').textContent = NPR(bonus * 100);
    document.getElementById('total-price-display').textContent = NPR(total * 100);
    
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
  }
}

window.updateProfessionalPrice = updateProfessionalPrice;
window.viewTaskDetails = viewTaskDetails;
window.openApplyModal = openApplyModal;
window.submitApplication = submitApplication;
window.viewApplicants = viewApplicants;
window.approveApplication = approveApplication;
window.rejectApplication = rejectApplication;
window.showUploadProof = showUploadProof;
window.approveTask = approveTask;
window.acceptTask = acceptTask;
window.startTask = startTask;
window.rateTask = rateTask;
window.openSetLocationModal = openSetLocationModal;
window.saveTaskerLocation = saveTaskerLocation;
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
let liveTrackingMapId = null;
let taskerMarkerLiveId = null;
let requesterMarkerLiveId = null;
let trackingTaskId = null;
let locationUpdateInterval = null;

window.openLiveTracking = async function (taskId) {
  try {
    trackingTaskId = taskId;
    
    // Fetch task details
    const taskRes = await fetch(`${API_URL}/tasks/${taskId}`, { headers: authHeaders() });
    if (!taskRes.ok) {
      showToast('Failed to load task details', 'danger');
      return;
    }
    
    const taskData = await taskRes.json();
    const task = taskData.task;
    
    // Populate task info
    const taskInfo = document.getElementById('task-info-tracking');
    if (taskInfo) {
      taskInfo.innerHTML = `
        <div class="mb-2">
          <div class="fw-semibold">${task.title || 'Task'}</div>
          <div class="text-muted small">${task.description || 'No description'}</div>
        </div>
        <div class="d-flex justify-content-between mb-1">
          <span class="text-muted">Status:</span>
          <span class="badge badge-${task.status}">${task.status}</span>
        </div>
        <div class="d-flex justify-content-between mb-1">
          <span class="text-muted">Price:</span>
          <span class="fw-semibold text-success">NPR ${task.price || 0}</span>
        </div>
        <div class="d-flex justify-content-between">
          <span class="text-muted">Duration:</span>
          <span>${task.durationMin || 0} min</span>
        </div>
      `;
    }
    
    // Fetch and populate tasker info if assigned
    if (task.assignedTaskerId) {
      // Handle if assignedTaskerId is an object (populated) or string (ID)
      const taskerId = typeof task.assignedTaskerId === 'object' ? task.assignedTaskerId._id : task.assignedTaskerId;
      const taskerRes = await fetch(`${API_URL}/users/${taskerId}`, { headers: authHeaders() });
      if (taskerRes.ok) {
        const taskerData = await taskerRes.json();
        const tasker = taskerData.user;
        
        const taskerInfo = document.getElementById('tasker-info');
        if (taskerInfo) {
          taskerInfo.innerHTML = `
            <div class="d-flex align-items-center mb-2">
              <div class="profile-avatar me-2" style="width: 40px; height: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                ${(tasker.name || tasker.phone || 'T')[0].toUpperCase()}
              </div>
              <div>
                <div class="fw-semibold">${tasker.name || 'Tasker'}</div>
                <div class="text-muted small">${tasker.phone || ''}</div>
              </div>
            </div>
            <div class="d-flex justify-content-between">
              <span class="text-muted">Rating:</span>
              <span class="badge bg-warning text-dark">
                <i class="bi bi-star-fill"></i> ${(tasker.ratingAvg || 0).toFixed(1)}
              </span>
            </div>
          `;
        }
      }
    } else {
      const taskerInfo = document.getElementById('tasker-info');
      if (taskerInfo) {
        taskerInfo.innerHTML = '<p class="text-muted mb-0">No tasker assigned yet</p>';
      }
    }
    
    // Open modal
    const modal = new bootstrap.Modal(document.getElementById('liveTrackingModal'));
    modal.show();

    setTimeout(() => initLiveTrackingMap(taskId), 300);
    startLocationSharing(taskId);
    
  } catch (error) {
    console.error('Error opening live tracking:', error);
    showToast('Failed to open live tracking', 'danger');
  }
};

function initLiveTrackingMap(taskId) {
  if (!galliMapsService.isLoaded()) {
    console.warn('GalliMaps not loaded yet, retrying...');

    // Retry up to 5 times
    if (!window._liveTrackingMapInitRetries) window._liveTrackingMapInitRetries = 0;
    window._liveTrackingMapInitRetries++;

    if (window._liveTrackingMapInitRetries < 5) {
      setTimeout(() => initLiveTrackingMap(taskId), 500);
    } else {
      showToast('Unable to load tracking map. Please refresh the page.', 'danger');
      window._liveTrackingMapInitRetries = 0;
    }
    return;
  }

  const mapEl = document.getElementById('live-tracking-map');
  if (!mapEl) return;

  if (!liveTrackingMapId) {
    try {
      // Initialize GalliMaps for live tracking
      liveTrackingMapId = galliMapsService.initializeMap({
        containerId: 'live-tracking-map',
        center: [selectedLocation.lat, selectedLocation.lng],
        zoom: 14,
        clickable: false,
        onLoad: () => {
          console.log('GalliMaps loaded for live tracking');
          window._liveTrackingMapInitRetries = 0; // Reset retry counter on success

          // Add zoom controls after map loads
          try {
            galliMapsService.addZoomControls(liveTrackingMapId, 'top-right');
          } catch (error) {
            console.error('Failed to add zoom controls:', error);
          }
        },
        onError: (error) => {
          console.error('GalliMaps live tracking error:', error);
          const userMessage = galliMapsService.handleError(error, 'live tracking');
          showToast(userMessage, 'danger');

          // Reset map ID to allow retry
          liveTrackingMapId = null;
        }
      });
    } catch (error) {
      console.error('Failed to initialize live tracking map:', error);
      const userMessage = galliMapsService.handleError(error, 'live tracking initialization');
      showToast(userMessage, 'danger');

      // Reset map ID to allow retry
      liveTrackingMapId = null;
      return;
    }
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

      // Add red marker for task location
      if (!requesterMarkerLiveId) {
        try {
          requesterMarkerLiveId = galliMapsService.addMarker(liveTrackingMapId, {
            latLng: [lat, lng],
            color: '#dc2626', // Red for task location
            draggable: false,
            popupText: 'Task Location'
          });
        } catch (error) {
          console.error('Failed to add task location marker:', error);
        }
      }

      // Center map on task location
      try {
        galliMapsService.setCenter(liveTrackingMapId, [lat, lng], 14, false);
      } catch (error) {
        console.error('Failed to center map:', error);
      }
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

function listenForLocationUpdates(taskId) {
  if (!socket) return;

  socket.off('tasker_location');
  socket.on('tasker_location', (data) => {
    if (data.taskId !== taskId) return;

    const { lat, lng } = data;

    // Add or update blue marker for tasker location
    if (!taskerMarkerLiveId) {
      try {
        taskerMarkerLiveId = galliMapsService.addMarker(liveTrackingMapId, {
          latLng: [lat, lng],
          color: '#3b82f6', // Blue for tasker location
          draggable: false,
          popupText: 'Tasker Location (Live)'
        });
      } catch (error) {
        console.error('Failed to add tasker marker:', error);
        return;
      }
    } else {
      // Update marker position with smooth animation
      try {
        galliMapsService.updateMarkerPosition(liveTrackingMapId, taskerMarkerLiveId, [lat, lng]);
      } catch (error) {
        console.error('Failed to update tasker marker:', error);
        return;
      }
    }

    // Auto-fit bounds to show both markers
    if (requesterMarkerLiveId && taskerMarkerLiveId) {
      try {
        const markers = galliMapsService.markers.get(liveTrackingMapId);
        const taskerMarkerData = markers.get(taskerMarkerLiveId);
        const requesterMarkerData = markers.get(requesterMarkerLiveId);

        if (taskerMarkerData && requesterMarkerData) {
          const bounds = [
            taskerMarkerData.latLng,
            requesterMarkerData.latLng
          ];

          galliMapsService.fitBounds(liveTrackingMapId, bounds, {
            padding: 100,
            duration: 1000
          });

          // Calculate distance and ETA
          const distance = calculateDistance(
            taskerMarkerData.latLng[0],
            taskerMarkerData.latLng[1],
            requesterMarkerData.latLng[0],
            requesterMarkerData.latLng[1]
          );
          const eta = Math.round(distance / 0.5); // Assuming 30 km/h average speed

          // Update status display
          const statusEl = document.querySelector('#tasker-info .badge');
          if (statusEl) {
            if (distance < 0.1) {
              statusEl.textContent = 'Arrived';
              statusEl.className = 'badge bg-success';
            } else {
              statusEl.textContent = `${distance.toFixed(2)} km away (ETA: ${eta} min)`;
              statusEl.className = 'badge bg-info';
            }
          }
        }
      } catch (error) {
        console.error('Failed to fit bounds:', error);
      }
    }
  });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Clean up when live tracking modal is closed
document.getElementById('liveTrackingModal')?.addEventListener('hidden.bs.modal', () => {
  if (locationUpdateInterval) {
    clearInterval(locationUpdateInterval);
    locationUpdateInterval = null;
  }
  if (socket) socket.off('tasker_location');

  // Clean up markers
  if (liveTrackingMapId) {
    if (taskerMarkerLiveId) {
      try {
        galliMapsService.removeMarker(liveTrackingMapId, taskerMarkerLiveId);
      } catch (e) { }
      taskerMarkerLiveId = null;
    }
    if (requesterMarkerLiveId) {
      try {
        galliMapsService.removeMarker(liveTrackingMapId, requesterMarkerLiveId);
      } catch (e) { }
      requesterMarkerLiveId = null;
    }
  }
});

