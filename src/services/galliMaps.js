const axios = require('axios');

const GALLI_API_BASE = 'https://route-init.gallimap.com/api/v1';
const GALLI_TOKEN = process.env.GALLI_MAPS_API_KEY || 'urle63a1458-7833-4b82-b946-19e4ef1f1138';

console.log('🗺️  Galli Maps initialized with token:', GALLI_TOKEN.substring(0, 10) + '...');

/**
 * Galli Maps API Service
 * Provides geocoding, routing, and search functionality for Nepal
 */

// Autocomplete search - suggests locations as user types
async function autocomplete(word, lat, lng) {
  try {
    const response = await axios.get(`${GALLI_API_BASE}/search/autocomplete`, {
      params: {
        accessToken: GALLI_TOKEN,
        word,
        lat,
        lng
      },
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    console.warn('⚠️  Galli Maps autocomplete unavailable:', error.response?.status || error.message);
    // Return mock data for development
    return { 
      success: true, 
      message: 'Mock data (Galli Maps API unavailable)',
      data: [
        { name: `${word} - Kathmandu`, province: 'Bagmati', district: 'Kathmandu', municipality: 'Kathmandu', ward: '1', id: 'mock1' },
        { name: `${word} - Lalitpur`, province: 'Bagmati', district: 'Lalitpur', municipality: 'Lalitpur', ward: '1', id: 'mock2' }
      ]
    };
  }
}

// Search API - get coordinates for a location name
async function search(name, currentLat, currentLng) {
  try {
    const response = await axios.get(`${GALLI_API_BASE}/search/currentLocation`, {
      params: {
        accessToken: GALLI_TOKEN,
        name,
        currentLat,
        currentLng
      },
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    console.warn('⚠️  Galli Maps search unavailable:', error.response?.status || error.message);
    // Return mock coordinates near Kathmandu
    return { 
      success: true,
      message: 'Mock data (Galli Maps API unavailable)',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            searchedItem: name,
            province: 'Bagmati',
            district: 'Kathmandu',
            municipality: 'Kathmandu',
            ward: '1',
            distance: 0
          },
          geometry: {
            type: 'Point',
            coordinates: [parseFloat(currentLng) || 85.3240, parseFloat(currentLat) || 27.7172]
          }
        }]
      }
    };
  }
}

// Reverse geocoding - get address from coordinates
async function reverseGeocode(lat, lng) {
  try {
    const response = await axios.get(`${GALLI_API_BASE}/reverse/generalReverse`, {
      params: {
        accessToken: GALLI_TOKEN,
        lat,
        lng
      },
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    console.warn('⚠️  Galli Maps reverse geocode unavailable:', error.response?.status || error.message);
    // Return mock address
    return { 
      success: true,
      message: 'Mock data (Galli Maps API unavailable)',
      data: {
        generalName: 'Kathmandu Area',
        roadName: 'Main Road',
        place: 'Kathmandu',
        municipality: 'Kathmandu Metropolitan City',
        ward: '1',
        district: 'Kathmandu',
        province: 'Bagmati Province'
      }
    };
  }
}

// Get route between two points
async function getRoute(srcLat, srcLng, dstLat, dstLng, mode = 'driving') {
  try {
    const response = await axios.get(`${GALLI_API_BASE}/routing`, {
      params: {
        accessToken: GALLI_TOKEN,
        mode, // driving, walking, cycling
        srcLat,
        srcLng,
        dstLat,
        dstLng
      },
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    console.warn('⚠️  Galli Maps routing unavailable:', error.response?.status || error.message);
    // Return straight line route as fallback
    const distanceResult = await getDistance(srcLat, srcLng, dstLat, dstLng, mode);
    const routeData = distanceResult.data.data[0];
    
    return { 
      success: true,
      message: 'Mock data (Galli Maps API unavailable)',
      data: {
        success: true,
        message: 'Straight line route (API unavailable)',
        data: [{
          distance: routeData.distance,
          duration: routeData.duration,
          latlngs: [
            [parseFloat(srcLng), parseFloat(srcLat)],
            [parseFloat(dstLng), parseFloat(dstLat)]
          ]
        }]
      }
    };
  }
}

// Get distance and duration between two points
async function getDistance(srcLat, srcLng, dstLat, dstLng, mode = 'driving') {
  try {
    const response = await axios.get(`${GALLI_API_BASE}/routing/distance`, {
      params: {
        accessToken: GALLI_TOKEN,
        mode, // driving, walking, cycling
        srcLat,
        srcLng,
        dstLat,
        dstLng
      },
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    console.warn('⚠️  Galli Maps distance unavailable:', error.response?.status || error.message);
    // Calculate straight-line distance as fallback (Haversine formula)
    const R = 6371000; // Earth radius in meters
    const dLat = (dstLat - srcLat) * Math.PI / 180;
    const dLng = (dstLng - srcLng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(srcLat * Math.PI / 180) * Math.cos(dstLat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    
    // Estimate duration based on mode (rough estimates)
    const speeds = { walking: 5, cycling: 15, driving: 30 }; // km/h
    const duration = (distance / 1000) / speeds[mode] * 3600; // seconds
    
    return { 
      success: true,
      message: 'Mock data (Galli Maps API unavailable)',
      data: {
        success: true,
        message: 'Calculated using Haversine formula',
        data: [{
          distance: Math.round(distance),
          duration: Math.round(duration)
        }]
      }
    };
  }
}

module.exports = {
  autocomplete,
  search,
  reverseGeocode,
  getRoute,
  getDistance,
  GALLI_TOKEN
};
