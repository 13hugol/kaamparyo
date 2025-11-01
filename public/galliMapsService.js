/**
 * GalliMaps Service Module
 * Provides a clean interface for integrating GalliMaps Vector Plugin
 * into the KaamParyo application
 */

class GalliMapsService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.maps = new Map(); // Store map instances by ID
    this.markers = new Map(); // Store markers by map ID
    this.isLibraryLoaded = false;
    this.loadPromise = null;
    this.isOnline = navigator.onLine;
    this.retryAttempts = new Map(); // Track retry attempts for operations
    this.maxRetries = 3;

    // Set up network connectivity monitoring
    this._setupNetworkMonitoring();

    // Check library load status
    this._checkLibraryLoad();
  }

  /**
   * Set up network connectivity monitoring
   * @private
   */
  _setupNetworkMonitoring() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this._logError('Network connection restored', { level: 'info' });
      this._notifyNetworkStatus(true);
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this._logError('Network connection lost', { level: 'warn' });
      this._notifyNetworkStatus(false);
    });
  }

  /**
   * Notify about network status changes
   * @private
   * @param {boolean} isOnline - Whether network is online
   */
  _notifyNetworkStatus(isOnline) {
    const event = new CustomEvent('gallimaps:network', {
      detail: { isOnline }
    });
    window.dispatchEvent(event);
  }

  /**
   * Check if GalliMaps library is loaded
   * @private
   */
  _checkLibraryLoad() {
    if (typeof GalliMapPlugin !== 'undefined') {
      this.isLibraryLoaded = true;
      this._logError('GalliMaps library loaded successfully', { level: 'info' });
    } else {
      this.isLibraryLoaded = false;
      this._logError('GalliMaps library not loaded', {
        level: 'error',
        context: 'library_check'
      });

      // Retry checking after a delay
      setTimeout(() => this._checkLibraryLoad(), 1000);
    }
  }

  /**
   * Log errors with detailed context
   * @private
   * @param {string} message - Error message
   * @param {Object} context - Additional context
   */
  _logError(message, context = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      message,
      service: 'GalliMapsService',
      ...context
    };

    const level = context.level || 'error';

    switch (level) {
      case 'info':
        console.log('[GalliMaps Info]', message, context);
        break;
      case 'warn':
        console.warn('[GalliMaps Warning]', message, context);
        break;
      case 'error':
      default:
        console.error('[GalliMaps Error]', message, context);
        break;
    }

    // Dispatch custom event for error tracking integration
    const event = new CustomEvent('gallimaps:error', {
      detail: logEntry
    });
    window.dispatchEvent(event);
  }

  /**
   * Retry a failed operation
   * @private
   * @param {string} operationKey - Unique key for the operation
   * @param {Function} operation - Function to retry
   * @param {Object} context - Context for logging
   * @returns {Promise<any>} Result of the operation
   */
  async _retryOperation(operationKey, operation, context = {}) {
    const attempts = this.retryAttempts.get(operationKey) || 0;

    if (attempts >= this.maxRetries) {
      this.retryAttempts.delete(operationKey);
      const error = new Error(`Operation failed after ${this.maxRetries} retries`);
      this._logError(error.message, {
        operationKey,
        attempts,
        ...context
      });
      throw error;
    }

    try {
      const result = await operation();
      this.retryAttempts.delete(operationKey);
      return result;
    } catch (error) {
      this.retryAttempts.set(operationKey, attempts + 1);
      this._logError(`Retry attempt ${attempts + 1} for ${operationKey}`, {
        operationKey,
        attempts: attempts + 1,
        error: error.message,
        ...context
      });

      // Wait before retrying (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, attempts), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));

      return this._retryOperation(operationKey, operation, context);
    }
  }

  /**
   * Check if GalliMaps library is loaded
   * @returns {boolean}
   */
  isLoaded() {
    return typeof GalliMapPlugin !== 'undefined';
  }

  /**
   * Get library version
   * @returns {string}
   */
  getLibraryVersion() {
    if (this.isLoaded() && GalliMapPlugin.version) {
      return GalliMapPlugin.version;
    }
    return 'unknown';
  }

  /**
   * Validate coordinates are within Nepal bounds
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {boolean} strict - If true, throw error for out-of-bounds coordinates
   * @throws {Error} If coordinates are invalid
   * @returns {Object} Validation result with warnings
   */
  validateCoordinates(lat, lng, strict = false) {
    const result = {
      valid: true,
      warnings: [],
      inNepalBounds: true
    };

    // Check if coordinates are numbers
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      const error = new Error('Coordinates must be numbers');
      this._logError(error.message, {
        lat,
        lng,
        context: 'coordinate_validation'
      });
      throw error;
    }

    // Check for NaN
    if (isNaN(lat) || isNaN(lng)) {
      const error = new Error('Coordinates cannot be NaN');
      this._logError(error.message, {
        lat,
        lng,
        context: 'coordinate_validation'
      });
      throw error;
    }

    // Check for valid latitude range (-90 to 90)
    if (lat < -90 || lat > 90) {
      const error = new Error(`Invalid latitude: ${lat}. Must be between -90 and 90`);
      this._logError(error.message, {
        lat,
        lng,
        context: 'coordinate_validation'
      });
      throw error;
    }

    // Check for valid longitude range (-180 to 180)
    if (lng < -180 || lng > 180) {
      const error = new Error(`Invalid longitude: ${lng}. Must be between -180 and 180`);
      this._logError(error.message, {
        lat,
        lng,
        context: 'coordinate_validation'
      });
      throw error;
    }

    // Nepal bounds: lat 26-31, lng 80-89
    if (lat < 26 || lat > 31 || lng < 80 || lng > 89) {
      result.inNepalBounds = false;
      const warning = `Coordinates [${lat.toFixed(4)}, ${lng.toFixed(4)}] are outside Nepal bounds (lat: 26-31, lng: 80-89)`;
      result.warnings.push(warning);

      this._logError(warning, {
        level: 'warn',
        lat,
        lng,
        context: 'coordinate_validation',
        nepalBounds: { lat: [26, 31], lng: [80, 89] }
      });

      if (strict) {
        const error = new Error(warning);
        this._logError(error.message, {
          lat,
          lng,
          context: 'coordinate_validation',
          strict: true
        });
        throw error;
      }
    }

    return result;
  }

  /**
   * Initialize a new GalliMaps instance
   * @param {Object} options - Map configuration
   * @param {string} options.containerId - HTML div ID for map
   * @param {Array} options.center - [lat, lng] coordinates
   * @param {number} options.zoom - Initial zoom level (default: 13)
   * @param {boolean} options.clickable - Enable click events (default: true)
   * @param {Function} options.onLoad - Callback when map loads
   * @param {Function} options.onError - Callback for errors
   * @returns {string} mapId - Unique identifier for this map instance
   */
  initializeMap(options) {
    const {
      containerId,
      center = [27.7172, 85.3240], // Kathmandu default
      zoom = 13,
      clickable = true,
      onLoad,
      onError
    } = options;

    // Validate container ID
    if (!containerId) {
      const error = new Error('Container ID is required');
      this._logError(error.message, {
        context: 'map_initialization',
        options
      });
      if (onError) onError(error);
      throw error;
    }

    // Check if container exists
    const container = document.getElementById(containerId);
    if (!container) {
      const error = new Error(`Container element '${containerId}' not found`);
      this._logError(error.message, {
        context: 'map_initialization',
        containerId
      });
      if (onError) onError(error);
      throw error;
    }

    // Check if library is loaded
    if (!this.isLoaded()) {
      const error = new Error('GalliMaps library not loaded. Please refresh the page.');
      this._logError(error.message, {
        context: 'map_initialization',
        containerId,
        libraryCheck: typeof GalliMapPlugin
      });
      if (onError) onError(error);
      throw error;
    }

    // Check network connectivity
    if (!this.isOnline) {
      const error = new Error('No internet connection. Please check your network.');
      this._logError(error.message, {
        level: 'warn',
        context: 'map_initialization',
        containerId
      });
      if (onError) onError(error);
      throw error;
    }

    try {
      // Validate coordinates
      const validation = this.validateCoordinates(center[0], center[1]);
      if (validation.warnings.length > 0) {
        this._logError('Coordinate validation warnings', {
          level: 'warn',
          warnings: validation.warnings,
          center
        });
      }

      // Create unique map ID
      const mapId = `map-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      this._logError(`Initializing map: ${mapId}`, {
        level: 'info',
        containerId,
        center,
        zoom
      });

      // Initialize GalliMaps with correct API structure
      const galliMapsConfig = {
        accessToken: this.accessToken,
        map: {
          container: containerId,
          center: center,
          zoom: zoom,
          minZoom: 5,
          maxZoom: 25,
          clickable: clickable
        },
        customClickFunctions: []
      };

      console.log('[GalliMaps] Initializing with config:', galliMapsConfig);
      const galliMap = new GalliMapPlugin(galliMapsConfig);

      // Store map instance
      this.maps.set(mapId, {
        id: mapId,
        containerId: containerId,
        instance: galliMap,
        center: center,
        zoom: zoom,
        clickListeners: [],
        initTime: Date.now()
      });

      // Initialize markers storage for this map
      this.markers.set(mapId, new Map());

      // Handle map load event
      if (galliMap.on) {
        galliMap.on('load', () => {
          const loadTime = Date.now() - this.maps.get(mapId).initTime;
          this._logError(`Map loaded successfully: ${mapId}`, {
            level: 'info',
            containerId,
            loadTime: `${loadTime}ms`
          });
          if (onLoad) onLoad(mapId);
        });

        galliMap.on('error', (error) => {
          // Check for authentication errors
          if (error.status === 401 || error.status === 403 || error.message?.includes('auth')) {
            this._logError('Authentication error with GalliMaps API', {
              error: error.message || error,
              status: error.status,
              context: 'map_authentication',
              mapId,
              containerId
            });

            const authError = new Error('Map service unavailable. Please try again later.');
            if (onError) onError(authError);
          } else {
            this._logError('GalliMaps runtime error', {
              error: error.message || error,
              status: error.status,
              context: 'map_runtime',
              mapId,
              containerId
            });
            if (onError) onError(error);
          }
        });
      } else if (onLoad) {
        // If no event system, call onLoad immediately
        setTimeout(() => {
          this._logError(`Map loaded (no event system): ${mapId}`, {
            level: 'info',
            containerId
          });
          onLoad(mapId);
        }, 100);
      }

      return mapId;
    } catch (error) {
      console.error('Failed to initialize GalliMaps:', error);
      if (onError) onError(error);
      throw error;
    }
  }

  /**
   * Get a map instance by ID
   * @param {string} mapId - Map identifier
   * @returns {Object} Map data object
   */
  getMap(mapId) {
    const mapData = this.maps.get(mapId);
    if (!mapData) {
      throw new Error(`Map '${mapId}' not found`);
    }
    return mapData;
  }

  /**
   * Destroy a map instance
   * @param {string} mapId - Map identifier
   */
  destroyMap(mapId) {
    const mapData = this.maps.get(mapId);
    if (!mapData) {
      console.warn(`Map '${mapId}' not found`);
      return;
    }

    try {
      // Remove all markers first
      const markers = this.markers.get(mapId);
      if (markers) {
        markers.forEach((marker, markerId) => {
          this.removeMarker(mapId, markerId);
        });
      }

      // Destroy map instance
      if (mapData.instance && mapData.instance.remove) {
        mapData.instance.remove();
      }

      // Clean up storage
      this.maps.delete(mapId);
      this.markers.delete(mapId);

      console.log(`Map '${mapId}' destroyed`);
    } catch (error) {
      console.error(`Failed to destroy map '${mapId}':`, error);
    }
  }

  /**
   * Add a marker to the map
   * @param {string} mapId - Map instance identifier
   * @param {Object} markerOptions - Marker configuration
   * @param {Array} markerOptions.latLng - [lat, lng] coordinates
   * @param {string} markerOptions.color - Hex color code (default: '#dc2626')
   * @param {boolean} markerOptions.draggable - Allow dragging (default: false)
   * @param {Function} markerOptions.onDragEnd - Callback on drag end
   * @param {Function} markerOptions.onClick - Callback on marker click
   * @param {string} markerOptions.popupText - Optional popup text
   * @returns {string} markerId - Unique identifier for this marker
   */
  addMarker(mapId, markerOptions) {
    const mapData = this.getMap(mapId);
    const {
      latLng,
      color = '#dc2626',
      draggable = false,
      onDragEnd,
      onClick,
      popupText
    } = markerOptions;

    if (!latLng || latLng.length !== 2) {
      throw new Error('Marker latLng must be an array of [lat, lng]');
    }

    try {
      // Validate coordinates
      this.validateCoordinates(latLng[0], latLng[1]);

      // Create unique marker ID
      const markerId = `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create marker using GalliMaps API
      const galliMarker = mapData.instance.addMarker({
        lngLat: [latLng[1], latLng[0]], // GalliMaps uses [lng, lat]
        color: color,
        draggable: draggable
      });

      // Store marker data
      const markers = this.markers.get(mapId);
      markers.set(markerId, {
        id: markerId,
        instance: galliMarker,
        latLng: latLng,
        color: color,
        draggable: draggable
      });

      // Add drag end listener
      if (draggable && onDragEnd && galliMarker.on) {
        galliMarker.on('dragend', () => {
          const newPos = galliMarker.getLngLat();
          const newLatLng = [newPos.lat, newPos.lng];

          // Update stored position
          const markerData = markers.get(markerId);
          if (markerData) {
            markerData.latLng = newLatLng;
          }

          onDragEnd(newLatLng);
        });
      }

      // Add click listener
      if (onClick && galliMarker.on) {
        galliMarker.on('click', () => {
          onClick(markerId, latLng);
        });
      }

      // Add popup if provided
      if (popupText && galliMarker.setPopup) {
        galliMarker.setPopup(popupText);
      }

      console.log(`Marker '${markerId}' added to map '${mapId}'`);
      return markerId;
    } catch (error) {
      console.error('Failed to add marker:', error);
      throw error;
    }
  }

  /**
   * Remove a marker from the map
   * @param {string} mapId - Map instance identifier
   * @param {string} markerId - Marker identifier
   */
  removeMarker(mapId, markerId) {
    const markers = this.markers.get(mapId);
    if (!markers) {
      console.warn(`No markers found for map '${mapId}'`);
      return;
    }

    const markerData = markers.get(markerId);
    if (!markerData) {
      console.warn(`Marker '${markerId}' not found`);
      return;
    }

    try {
      // Remove marker from map
      if (markerData.instance && markerData.instance.remove) {
        markerData.instance.remove();
      }

      // Remove from storage
      markers.delete(markerId);

      console.log(`Marker '${markerId}' removed from map '${mapId}'`);
    } catch (error) {
      console.error(`Failed to remove marker '${markerId}':`, error);
    }
  }

  /**
   * Update marker position
   * @param {string} mapId - Map instance identifier
   * @param {string} markerId - Marker identifier
   * @param {Array} latLng - New [lat, lng] coordinates
   */
  updateMarkerPosition(mapId, markerId, latLng) {
    const markers = this.markers.get(mapId);
    if (!markers) {
      throw new Error(`No markers found for map '${mapId}'`);
    }

    const markerData = markers.get(markerId);
    if (!markerData) {
      throw new Error(`Marker '${markerId}' not found`);
    }

    try {
      // Validate coordinates
      this.validateCoordinates(latLng[0], latLng[1]);

      // Update marker position
      if (markerData.instance && markerData.instance.setLngLat) {
        markerData.instance.setLngLat([latLng[1], latLng[0]]); // [lng, lat]
      }

      // Update stored position
      markerData.latLng = latLng;

      console.log(`Marker '${markerId}' position updated`);
    } catch (error) {
      console.error('Failed to update marker position:', error);
      throw error;
    }
  }

  /**
   * Autocomplete search for locations
   * @param {string} searchText - Search query (minimum 4 characters)
   * @returns {Promise<Array>} Array of location suggestions
   */
  async autoCompleteSearch(searchText) {
    if (!searchText || searchText.length < 4) {
      const error = new Error('Search text must be at least 4 characters');
      this._logError(error.message, {
        level: 'warn',
        searchText,
        context: 'autocomplete_search'
      });
      throw error;
    }

    // Check network connectivity
    if (!this.isOnline) {
      const error = new Error('No internet connection. Please check your network.');
      this._logError(error.message, {
        level: 'warn',
        context: 'autocomplete_search'
      });
      throw error;
    }

    // Sanitize input
    const sanitized = searchText.trim().replace(/[<>]/g, '').substring(0, 100);

    const operationKey = `autocomplete-${sanitized}`;

    return this._retryOperation(operationKey, async () => {
      try {
        this._logError(`Autocomplete search: "${sanitized}"`, {
          level: 'info',
          context: 'autocomplete_search'
        });

        // Call GalliMaps autocomplete API
        const response = await fetch(
          `https://gallimap.com/api/autocomplete?q=${encodeURIComponent(sanitized)}&token=${this.accessToken}`,
          {
            signal: AbortSignal.timeout(10000) // 10 second timeout
          }
        );

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            const error = new Error('Authentication failed with GalliMaps API');
            this._logError(error.message, {
              status: response.status,
              context: 'autocomplete_search',
              query: sanitized
            });
            throw error;
          }

          const error = new Error(`Autocomplete API error: ${response.status}`);
          this._logError(error.message, {
            status: response.status,
            context: 'autocomplete_search',
            query: sanitized
          });
          throw error;
        }

        const data = await response.json();

        this._logError(`Autocomplete results: ${data.results?.length || 0} found`, {
          level: 'info',
          context: 'autocomplete_search',
          query: sanitized
        });

        // Return formatted results
        return (data.results || []).map(result => ({
          id: result.id || result.place_id,
          name: result.name || result.display_name,
          address: result.address || result.formatted_address,
          coordinates: {
            lat: result.lat || result.latitude,
            lng: result.lng || result.longitude
          },
          type: result.type || 'location',
          confidence: result.confidence || 1.0
        }));
      } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          this._logError('Autocomplete search timeout', {
            context: 'autocomplete_search',
            query: sanitized
          });
          throw new Error('Search request timed out. Please try again.');
        }

        this._logError('Autocomplete search failed', {
          error: error.message,
          context: 'autocomplete_search',
          query: sanitized
        });
        throw error;
      }
    }, {
      operation: 'autocomplete_search',
      query: sanitized
    });
  }

  /**
   * Search for a specific location
   * @param {string|Object} searchData - Search query or location data
   * @returns {Promise<Object>} Location details
   */
  async searchLocation(searchData) {
    let query;

    if (typeof searchData === 'string') {
      query = searchData.trim();
    } else if (searchData.id) {
      query = searchData.id;
    } else {
      const error = new Error('Invalid search data');
      this._logError(error.message, {
        searchData,
        context: 'location_search'
      });
      throw error;
    }

    // Check network connectivity
    if (!this.isOnline) {
      const error = new Error('No internet connection. Please check your network.');
      this._logError(error.message, {
        level: 'warn',
        context: 'location_search'
      });
      throw error;
    }

    const operationKey = `search-${query}`;

    return this._retryOperation(operationKey, async () => {
      try {
        this._logError(`Location search: "${query}"`, {
          level: 'info',
          context: 'location_search'
        });

        // Call GalliMaps search API
        const response = await fetch(
          `https://gallimap.com/api/search?q=${encodeURIComponent(query)}&token=${this.accessToken}`,
          {
            signal: AbortSignal.timeout(10000) // 10 second timeout
          }
        );

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            const error = new Error('Authentication failed with GalliMaps API');
            this._logError(error.message, {
              status: response.status,
              context: 'location_search',
              query
            });
            throw error;
          }

          const error = new Error(`Search API error: ${response.status}`);
          this._logError(error.message, {
            status: response.status,
            context: 'location_search',
            query
          });
          throw error;
        }

        const data = await response.json();

        if (!data.result) {
          const error = new Error('Location not found');
          this._logError(error.message, {
            level: 'warn',
            context: 'location_search',
            query
          });
          throw error;
        }

        const result = data.result;
        const locationData = {
          id: result.id || result.place_id,
          name: result.name || result.display_name,
          address: result.address || result.formatted_address,
          coordinates: {
            lat: result.lat || result.latitude,
            lng: result.lng || result.longitude
          },
          type: result.type || 'location',
          bounds: result.bounds || null
        };

        // Validate coordinates
        if (locationData.coordinates.lat && locationData.coordinates.lng) {
          this.validateCoordinates(locationData.coordinates.lat, locationData.coordinates.lng);
        }

        this._logError(`Location found: ${locationData.name}`, {
          level: 'info',
          context: 'location_search',
          coordinates: locationData.coordinates
        });

        return locationData;
      } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          this._logError('Location search timeout', {
            context: 'location_search',
            query
          });
          throw new Error('Search request timed out. Please try again.');
        }

        this._logError('Location search failed', {
          error: error.message,
          context: 'location_search',
          query
        });
        throw error;
      }
    }, {
      operation: 'location_search',
      query
    });
  }

  /**
   * Set map center and zoom
   * @param {string} mapId - Map instance identifier
   * @param {Array} latLng - [lat, lng] coordinates
   * @param {number} zoom - Zoom level (optional)
   * @param {boolean} animate - Animate transition (default: true)
   */
  setCenter(mapId, latLng, zoom, animate = true) {
    const mapData = this.getMap(mapId);

    try {
      // Validate coordinates
      this.validateCoordinates(latLng[0], latLng[1]);

      const options = {
        center: [latLng[1], latLng[0]], // [lng, lat]
        zoom: zoom !== undefined ? zoom : mapData.zoom
      };

      if (animate && mapData.instance.flyTo) {
        mapData.instance.flyTo({
          ...options,
          duration: 2000,
          essential: true
        });
      } else if (mapData.instance.setCenter) {
        mapData.instance.setCenter(options.center);
        if (zoom !== undefined && mapData.instance.setZoom) {
          mapData.instance.setZoom(zoom);
        }
      }

      // Update stored values
      mapData.center = latLng;
      if (zoom !== undefined) {
        mapData.zoom = zoom;
      }
    } catch (error) {
      console.error('Failed to set center:', error);
      throw error;
    }
  }

  /**
   * Fit map bounds to show multiple points
   * @param {string} mapId - Map instance identifier
   * @param {Array} bounds - Array of [lat, lng] coordinates
   * @param {Object} options - Fit bounds options
   */
  fitBounds(mapId, bounds, options = {}) {
    const mapData = this.getMap(mapId);

    if (!bounds || bounds.length < 2) {
      throw new Error('Bounds must contain at least 2 coordinates');
    }

    try {
      // Validate all coordinates
      bounds.forEach(coord => {
        this.validateCoordinates(coord[0], coord[1]);
      });

      // Convert to [lng, lat] format
      const lngLatBounds = bounds.map(coord => [coord[1], coord[0]]);

      if (mapData.instance.fitBounds) {
        mapData.instance.fitBounds(lngLatBounds, {
          padding: options.padding || 100,
          duration: options.duration || 1000,
          ...options
        });
      }
    } catch (error) {
      console.error('Failed to fit bounds:', error);
      throw error;
    }
  }

  /**
   * Add click listener to map
   * @param {string} mapId - Map instance identifier
   * @param {Function} callback - Callback function receiving {lat, lng}
   */
  addClickListener(mapId, callback) {
    const mapData = this.getMap(mapId);

    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    try {
      if (mapData.instance.on) {
        mapData.instance.on('click', (e) => {
          const latLng = {
            lat: e.lngLat.lat,
            lng: e.lngLat.lng
          };
          callback(latLng);
        });

        // Store listener reference
        mapData.clickListeners.push(callback);
      }
    } catch (error) {
      console.error('Failed to add click listener:', error);
      throw error;
    }
  }

  /**
   * Add zoom controls to map
   * @param {string} mapId - Map instance identifier
   * @param {string} position - Control position (default: 'top-right')
   */
  addZoomControls(mapId, position = 'top-right') {
    const mapData = this.getMap(mapId);

    try {
      if (mapData.instance.addControl) {
        // Try to add native GalliMaps zoom control
        mapData.instance.addControl('zoom', position);
        console.log(`Zoom controls added to map '${mapId}'`);
      } else {
        // Fallback: Create custom zoom controls
        this._addCustomZoomControls(mapId, position);
      }
    } catch (error) {
      console.error('Failed to add zoom controls:', error);
      // Try fallback
      this._addCustomZoomControls(mapId, position);
    }
  }

  /**
   * Add custom zoom controls (fallback)
   * @private
   * @param {string} mapId - Map instance identifier
   * @param {string} position - Control position
   */
  _addCustomZoomControls(mapId, position = 'top-right') {
    const mapData = this.getMap(mapId);
    const container = document.getElementById(mapData.containerId);

    if (!container) return;

    // Check if controls already exist
    if (container.querySelector('.gallimaps-zoom-controls')) {
      return;
    }

    // Create control container
    const controlDiv = document.createElement('div');
    controlDiv.className = 'gallimaps-zoom-controls';
    controlDiv.style.cssText = `
      position: absolute;
      ${position.includes('top') ? 'top: 10px;' : 'bottom: 10px;'}
      ${position.includes('right') ? 'right: 10px;' : 'left: 10px;'}
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 5px;
      background: white;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    `;

    // Zoom in button
    const zoomInBtn = document.createElement('button');
    zoomInBtn.innerHTML = '<i class="bi bi-plus"></i>';
    zoomInBtn.className = 'btn btn-sm btn-light';
    zoomInBtn.style.cssText = `
      width: 30px;
      height: 30px;
      padding: 0;
      border: none;
      border-bottom: 1px solid #ddd;
      border-radius: 4px 4px 0 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: bold;
    `;
    zoomInBtn.onclick = () => this.zoomIn(mapId);
    zoomInBtn.title = 'Zoom in';

    // Zoom out button
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.innerHTML = '<i class="bi bi-dash"></i>';
    zoomOutBtn.className = 'btn btn-sm btn-light';
    zoomOutBtn.style.cssText = `
      width: 30px;
      height: 30px;
      padding: 0;
      border: none;
      border-radius: 0 0 4px 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: bold;
    `;
    zoomOutBtn.onclick = () => this.zoomOut(mapId);
    zoomOutBtn.title = 'Zoom out';

    controlDiv.appendChild(zoomInBtn);
    controlDiv.appendChild(zoomOutBtn);
    container.appendChild(controlDiv);

    console.log(`Custom zoom controls added to map '${mapId}'`);
  }

  /**
   * Get current map zoom level
   * @param {string} mapId - Map instance identifier
   * @returns {number} Current zoom level
   */
  getZoom(mapId) {
    const mapData = this.getMap(mapId);

    if (mapData.instance.getZoom) {
      return mapData.instance.getZoom();
    }

    return mapData.zoom;
  }

  /**
   * Set map zoom level
   * @param {string} mapId - Map instance identifier
   * @param {number} zoom - Zoom level (5-25)
   * @param {boolean} animate - Animate zoom transition (default: true)
   */
  setZoom(mapId, zoom, animate = true) {
    const mapData = this.getMap(mapId);

    // Clamp zoom level to valid range
    const clampedZoom = Math.max(5, Math.min(25, zoom));

    if (zoom < 5 || zoom > 25) {
      console.warn(`Zoom level ${zoom} clamped to ${clampedZoom} (valid range: 5-25)`);
    }

    try {
      if (animate && mapData.instance.easeTo) {
        mapData.instance.easeTo({
          zoom: clampedZoom,
          duration: 300
        });
      } else if (mapData.instance.setZoom) {
        mapData.instance.setZoom(clampedZoom);
      }
      mapData.zoom = clampedZoom;
    } catch (error) {
      console.error('Failed to set zoom:', error);
      throw error;
    }
  }

  /**
   * Zoom in by one level
   * @param {string} mapId - Map instance identifier
   */
  zoomIn(mapId) {
    const currentZoom = this.getZoom(mapId);
    const newZoom = Math.min(25, currentZoom + 1);
    this.setZoom(mapId, newZoom, true);
  }

  /**
   * Zoom out by one level
   * @param {string} mapId - Map instance identifier
   */
  zoomOut(mapId) {
    const currentZoom = this.getZoom(mapId);
    const newZoom = Math.max(5, currentZoom - 1);
    this.setZoom(mapId, newZoom, true);
  }

  /**
   * Enable or disable scroll zoom
   * @param {string} mapId - Map instance identifier
   * @param {boolean} enabled - Enable or disable
   */
  setScrollZoom(mapId, enabled) {
    const mapData = this.getMap(mapId);

    try {
      if (mapData.instance.scrollZoom) {
        if (enabled) {
          mapData.instance.scrollZoom.enable();
        } else {
          mapData.instance.scrollZoom.disable();
        }
      }
    } catch (error) {
      console.error('Failed to set scroll zoom:', error);
    }
  }

  /**
   * Enable or disable drag pan
   * @param {string} mapId - Map instance identifier
   * @param {boolean} enabled - Enable or disable
   */
  setDragPan(mapId, enabled) {
    const mapData = this.getMap(mapId);

    try {
      if (mapData.instance.dragPan) {
        if (enabled) {
          mapData.instance.dragPan.enable();
        } else {
          mapData.instance.dragPan.disable();
        }
      }
    } catch (error) {
      console.error('Failed to set drag pan:', error);
    }
  }

  /**
   * Enable or disable double click zoom
   * @param {string} mapId - Map instance identifier
   * @param {boolean} enabled - Enable or disable
   */
  setDoubleClickZoom(mapId, enabled) {
    const mapData = this.getMap(mapId);

    try {
      if (mapData.instance.doubleClickZoom) {
        if (enabled) {
          mapData.instance.doubleClickZoom.enable();
        } else {
          mapData.instance.doubleClickZoom.disable();
        }
      }
    } catch (error) {
      console.error('Failed to set double click zoom:', error);
    }
  }

  /**
   * Enable or disable keyboard navigation
   * @param {string} mapId - Map instance identifier
   * @param {boolean} enabled - Enable or disable
   */
  setKeyboardNavigation(mapId, enabled) {
    const mapData = this.getMap(mapId);

    try {
      if (mapData.instance.keyboard) {
        if (enabled) {
          mapData.instance.keyboard.enable();
        } else {
          mapData.instance.keyboard.disable();
        }
      }
    } catch (error) {
      console.error('Failed to set keyboard navigation:', error);
    }
  }

  /**
   * Add a circle overlay to the map
   * @param {string} mapId - Map instance identifier
   * @param {Object} circleOptions - Circle configuration
   * @param {Array} circleOptions.center - [lat, lng] coordinates
   * @param {number} circleOptions.radiusKm - Radius in kilometers
   * @param {string} circleOptions.color - Fill color (default: '#3b82f6')
   * @param {number} circleOptions.opacity - Fill opacity (default: 0.2)
   * @param {string} circleOptions.strokeColor - Stroke color (default: '#3b82f6')
   * @param {number} circleOptions.strokeWidth - Stroke width (default: 2)
   * @returns {string} circleId - Unique identifier for this circle
   */
  addCircle(mapId, circleOptions) {
    const mapData = this.getMap(mapId);
    const {
      center,
      radiusKm,
      color = '#3b82f6',
      opacity = 0.2,
      strokeColor = '#3b82f6',
      strokeWidth = 2
    } = circleOptions;

    if (!center || center.length !== 2) {
      throw new Error('Circle center must be an array of [lat, lng]');
    }

    if (!radiusKm || radiusKm <= 0) {
      throw new Error('Circle radius must be a positive number');
    }

    try {
      // Validate coordinates
      this.validateCoordinates(center[0], center[1]);

      // Create unique circle ID
      const circleId = `circle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create circle using GalliMaps API
      if (mapData.instance.addCircle) {
        const galliCircle = mapData.instance.addCircle({
          center: [center[1], center[0]], // [lng, lat]
          radius: radiusKm * 1000, // Convert km to meters
          fillColor: color,
          fillOpacity: opacity,
          strokeColor: strokeColor,
          strokeWidth: strokeWidth
        });

        // Store circle reference
        if (!mapData.circles) {
          mapData.circles = new Map();
        }
        mapData.circles.set(circleId, {
          id: circleId,
          instance: galliCircle,
          center: center,
          radiusKm: radiusKm
        });

        console.log(`Circle '${circleId}' added to map '${mapId}'`);
        return circleId;
      } else {
        // Fallback: Create circle using GeoJSON if addCircle is not available
        const sourceId = `circle-source-${circleId}`;
        const layerId = `circle-layer-${circleId}`;
        const strokeLayerId = `circle-stroke-${circleId}`;

        // Calculate circle points
        const points = this._createCirclePoints(center[0], center[1], radiusKm);

        if (mapData.instance.addSource && mapData.instance.addLayer) {
          mapData.instance.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [points.map(p => [p[1], p[0]])] // [lng, lat]
              }
            }
          });

          // Add fill layer
          mapData.instance.addLayer({
            id: layerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': color,
              'fill-opacity': opacity
            }
          });

          // Add stroke layer
          mapData.instance.addLayer({
            id: strokeLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': strokeColor,
              'line-width': strokeWidth,
              'line-opacity': 0.8
            }
          });

          // Store circle reference
          if (!mapData.circles) {
            mapData.circles = new Map();
          }
          mapData.circles.set(circleId, {
            id: circleId,
            sourceId: sourceId,
            layerId: layerId,
            strokeLayerId: strokeLayerId,
            center: center,
            radiusKm: radiusKm
          });

          console.log(`Circle '${circleId}' added to map '${mapId}' using GeoJSON`);
          return circleId;
        }
      }

      throw new Error('Map does not support circle overlays');
    } catch (error) {
      console.error('Failed to add circle:', error);
      throw error;
    }
  }

  /**
   * Remove a circle from the map
   * @param {string} mapId - Map instance identifier
   * @param {string} circleId - Circle identifier
   */
  removeCircle(mapId, circleId) {
    const mapData = this.getMap(mapId);

    if (!mapData.circles) {
      console.warn(`No circles found for map '${mapId}'`);
      return;
    }

    const circleData = mapData.circles.get(circleId);
    if (!circleData) {
      console.warn(`Circle '${circleId}' not found`);
      return;
    }

    try {
      // Remove circle from map
      if (circleData.instance && circleData.instance.remove) {
        circleData.instance.remove();
      } else if (circleData.layerId && circleData.sourceId) {
        // Remove GeoJSON layers
        if (mapData.instance.getLayer(circleData.layerId)) {
          mapData.instance.removeLayer(circleData.layerId);
        }
        if (mapData.instance.getLayer(circleData.strokeLayerId)) {
          mapData.instance.removeLayer(circleData.strokeLayerId);
        }
        if (mapData.instance.getSource(circleData.sourceId)) {
          mapData.instance.removeSource(circleData.sourceId);
        }
      }

      // Remove from storage
      mapData.circles.delete(circleId);

      console.log(`Circle '${circleId}' removed from map '${mapId}'`);
    } catch (error) {
      console.error(`Failed to remove circle '${circleId}':`, error);
    }
  }

  /**
   * Update circle radius
   * @param {string} mapId - Map instance identifier
   * @param {string} circleId - Circle identifier
   * @param {number} radiusKm - New radius in kilometers
   */
  updateCircleRadius(mapId, circleId, radiusKm) {
    const mapData = this.getMap(mapId);

    if (!mapData.circles) {
      throw new Error(`No circles found for map '${mapId}'`);
    }

    const circleData = mapData.circles.get(circleId);
    if (!circleData) {
      throw new Error(`Circle '${circleId}' not found`);
    }

    try {
      if (circleData.instance && circleData.instance.setRadius) {
        circleData.instance.setRadius(radiusKm * 1000); // Convert km to meters
        circleData.radiusKm = radiusKm;
      } else if (circleData.sourceId) {
        // Update GeoJSON source
        const points = this._createCirclePoints(circleData.center[0], circleData.center[1], radiusKm);

        if (mapData.instance.getSource(circleData.sourceId)) {
          mapData.instance.getSource(circleData.sourceId).setData({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [points.map(p => [p[1], p[0]])] // [lng, lat]
            }
          });
          circleData.radiusKm = radiusKm;
        }
      }

      console.log(`Circle '${circleId}' radius updated to ${radiusKm} km`);
    } catch (error) {
      console.error('Failed to update circle radius:', error);
      throw error;
    }
  }

  /**
   * Create circle points for GeoJSON polygon
   * @private
   * @param {number} lat - Center latitude
   * @param {number} lng - Center longitude
   * @param {number} radiusKm - Radius in kilometers
   * @returns {Array} Array of [lat, lng] points
   */
  _createCirclePoints(lat, lng, radiusKm) {
    const points = [];
    const numPoints = 64;
    const earthRadius = 6371; // km

    for (let i = 0; i <= numPoints; i++) {
      const angle = (i * 360 / numPoints) * Math.PI / 180;

      const dx = radiusKm * Math.cos(angle);
      const dy = radiusKm * Math.sin(angle);

      const deltaLat = dy / earthRadius * (180 / Math.PI);
      const deltaLng = dx / (earthRadius * Math.cos(lat * Math.PI / 180)) * (180 / Math.PI);

      points.push([lat + deltaLat, lng + deltaLng]);
    }

    return points;
  }

  /**
   * Handle errors with user-friendly messages
   * @param {Error} error - Error object
   * @param {string} context - Context where error occurred
   * @returns {string} User-friendly error message
   */
  handleError(error, context = '') {
    console.error(`GalliMaps Error ${context}:`, error);

    // Map technical errors to user-friendly messages
    const errorMessages = {
      'AUTH_FAILED': 'Map service unavailable. Please try again later.',
      'NETWORK_ERROR': 'Connection lost. Please check your internet connection.',
      'INVALID_COORDINATES': 'Invalid location coordinates.',
      'LIBRARY_NOT_LOADED': 'Unable to load maps. Please refresh the page.',
      'CONTAINER_NOT_FOUND': 'Map container not found. Please refresh the page.'
    };

    // Check error type
    if (error.message && error.message.includes('not loaded')) {
      return errorMessages.LIBRARY_NOT_LOADED;
    }
    if (error.message && error.message.includes('not found')) {
      return errorMessages.CONTAINER_NOT_FOUND;
    }
    if (error.message && error.message.includes('Coordinates')) {
      return errorMessages.INVALID_COORDINATES;
    }
    if (error.code === 'AUTH_FAILED') {
      return errorMessages.AUTH_FAILED;
    }
    if (!navigator.onLine) {
      return errorMessages.NETWORK_ERROR;
    }

    // Default error message
    return 'An error occurred with the map. Please try again.';
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GalliMapsService;
}
