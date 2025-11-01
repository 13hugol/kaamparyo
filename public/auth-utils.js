// Authentication utilities with cookie support

// Cookie helper functions
function setCookie(name, value, days = 30) {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict`;
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
}

// Initialize token from cookie or localStorage
function initAuth() {
  let token = getCookie('kp_token');
  
  console.log('[Auth] Checking for token in cookie:', token ? 'Found' : 'Not found');
  
  // Fallback to localStorage for backward compatibility
  if (!token) {
    token = localStorage.getItem('token');
    if (token) {
      console.log('[Auth] Found token in localStorage, migrating to cookie');
      // Migrate to cookie
      setCookie('kp_token', token);
      localStorage.removeItem('token');
    }
  }
  
  return token;
}

// Save token to cookie and localStorage
function saveToken(token) {
  console.log('[Auth] Saving token to cookie');
  setCookie('kp_token', token, 30); // 30 days
  localStorage.setItem('token', token); // Backup
  console.log('[Auth] Token saved successfully');
}

// Save user data to cookie
function saveUser(user) {
  if (!user) return;
  
  console.log('[Auth] Saving user data to cookie:', user.name || user.phone);
  
  // Store essential user data (not sensitive info)
  const userData = {
    _id: user._id,
    name: user.name,
    phone: user.phone,
    ratingAvg: user.ratingAvg,
    ratingCount: user.ratingCount,
    isOnline: user.isOnline
  };
  
  setCookie('kp_user', JSON.stringify(userData), 30); // 30 days
  localStorage.setItem('currentUser', JSON.stringify(userData)); // Backup
  console.log('[Auth] User data saved successfully');
}

// Get user data from cookie
function getUser() {
  let userData = getCookie('kp_user');
  
  // Fallback to localStorage
  if (!userData) {
    userData = localStorage.getItem('currentUser');
    if (userData) {
      // Migrate to cookie
      setCookie('kp_user', userData, 30);
    }
  }
  
  try {
    return userData ? JSON.parse(userData) : null;
  } catch (e) {
    console.error('Failed to parse user data:', e);
    return null;
  }
}

// Clear token and user data from cookie and localStorage
function clearToken() {
  deleteCookie('kp_token');
  deleteCookie('kp_user');
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
}

// Check if user is authenticated
function isAuthenticated() {
  return !!initAuth();
}

// Redirect to login if not authenticated
function requireAuth() {
  if (!isAuthenticated()) {
    console.log('[Auth] Not authenticated, redirecting to home...');
    window.location.href = '/';
    return false;
  }
  return true;
}

// Export functions
window.authUtils = {
  setCookie,
  getCookie,
  deleteCookie,
  initAuth,
  saveToken,
  saveUser,
  getUser,
  clearToken,
  isAuthenticated,
  requireAuth
};
