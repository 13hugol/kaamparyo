# KaamParyo - HyperLocal Task Marketplace

## SYSTEM OVERVIEW

KaamParyo is a full-stack web application that connects task requesters with local taskers. It features real-time GPS tracking, secure payments, and a game-style HUD interface for live task monitoring.

**Core Concept:** Users can post tasks (errands, repairs, deliveries) with a location and price. Nearby taskers see these tasks, accept them, complete them while sharing their live location, and get paid through an escrow system.

---

## ARCHITECTURE

### Technology Stack
```
Frontend: Vanilla JavaScript + Bootstrap 5 + MapLibre GL
Backend: Node.js + Express.js
Database: MongoDB (Mongoose ODM)
Real-time: Socket.IO (WebSocket)
Maps: Galli Maps (Nepal-specific) + Leaflet
Payments: Stripe API
Auth: JWT tokens + OTP via SMS/Email
Deployment: Vercel Serverless Functions
```

### Project Structure
```
kaamparyo/
├── api/
│   └── index.js                 # Vercel serverless entry point
├── public/                      # Frontend static files
│   ├── index.html              # Single-page application
│   ├── app.js                  # Frontend JavaScript logic
│   └── styles.css              # UI styling
├── src/
│   ├── app.js                  # Express app configuration
│   ├── index.js                # Local development server
│   ├── models/                 # MongoDB schemas
│   │   ├── User.js
│   │   ├── Task.js
│   │   ├── Transaction.js
│   │   ├── Message.js
│   │   ├── Review.js
│   │   ├── Category.js
│   │   └── Settings.js
│   ├── routes/                 # API endpoints
│   │   ├── auth.js             # Authentication routes
│   │   ├── tasks.js            # Task CRUD + tracking
│   │   ├── users.js            # User profiles
│   │   ├── admin.js            # Admin panel
│   │   ├── categories.js       # Task categories
│   │   └── settings.js         # App settings
│   ├── services/               # External integrations
│   │   ├── otp.js              # OTP generation/verification
│   │   ├── payments.js         # Stripe integration
│   │   └── notify.js           # Email/SMS notifications
│   ├── utils/                  # Helper functions
│   │   ├── auth.js             # JWT utilities
│   │   └── validation.js       # Joi schemas
│   └── bootstrap/
│       └── defaults.js         # Database seeding
├── uploads/                    # File uploads (proof images)
├── .env                        # Environment variables
├── .env.example               # Environment template
├── package.json               # Dependencies
└── vercel.json                # Vercel configuration
```

---

## DATA MODELS

### User Schema
```javascript
{
  phone: String (unique),
  email: String,
  name: String,
  role: 'requester' | 'tasker' | 'both' | 'admin',
  tier: 'basic' | 'pro',
  location: { type: 'Point', coordinates: [lng, lat] },
  isOnline: Boolean,
  wallet: { balance: Number, pending: Number },
  ratingAvg: Number,
  ratingCount: Number,
  loyaltyPoints: Number,
  taskPoints: Number,
  rewardsLevel: String,
  phoneVerified: Boolean,
  emailVerified: Boolean,
  createdAt: Date
}
```

### Task Schema
```javascript
{
  requesterId: ObjectId (ref: User),
  assignedTaskerId: ObjectId (ref: User),
  title: String,
  description: String,
  categoryId: String,
  categoryName: String,
  price: Number (in paisa, 100 paisa = 1 NPR),
  durationMin: Number,
  location: { type: 'Point', coordinates: [lng, lat] },
  radiusKm: Number,
  status: 'posted' | 'accepted' | 'in_progress' | 'completed' | 'paid' | 'cancelled',
  paymentIntentId: String,
  escrowHeld: Boolean,
  proofUrl: String,
  requiredSkills: [String],
  biddingEnabled: Boolean,
  quickAccept: Boolean,
  allowedTier: 'all' | 'pro',
  isScheduled: Boolean,
  scheduledFor: Date,
  bidWindowEndsAt: Date,
  isRecurring: Boolean,
  recurringConfig: Object,
  offers: [{ taskerId, proposedPrice, message, status }],
  expenses: [{ description, amount, status, receiptUrl }],
  totalExpenses: Number,
  acceptedAt: Date,
  startedAt: Date,
  completedAt: Date,
  actualDuration: Number,
  createdAt: Date
}
```

### Transaction Schema
```javascript
{
  taskId: ObjectId (ref: Task),
  amount: Number,
  platformFee: Number,
  status: 'held' | 'released' | 'refunded',
  providerRef: String (Stripe payment ID),
  createdAt: Date
}
```

---

## API ENDPOINTS

### Authentication (`/auth`)
- `POST /auth/request-otp` - Generate and send OTP to phone/email
- `POST /auth/verify-otp` - Verify OTP and return JWT token
- `GET /auth/me` - Get current user profile (requires JWT)
- `PUT /auth/me` - Update user profile (requires JWT)

### Tasks (`/tasks`)
- `POST /tasks` - Create new task (requires JWT)
  - Creates Stripe PaymentIntent for escrow
  - Broadcasts to nearby taskers via Socket.IO
- `GET /tasks/nearby?lat=X&lng=Y&radiusKm=Z` - Get tasks within radius
  - Uses MongoDB geospatial query ($nearSphere)
  - Filters by user tier (basic/pro)
- `GET /tasks/:id` - Get task details with populated user data
- `POST /tasks/:id/accept` - Accept task (atomic update)
- `POST /tasks/:id/start` - Mark task as started
- `POST /tasks/:id/complete` - Mark as completed (requires proof upload)
- `POST /tasks/:id/approve` - Approve completion and release payment
- `POST /tasks/:id/reject` - Reject task and refund
- `PUT /tasks/:id` - Edit task (only if status is 'posted')
- `DELETE /tasks/:id` - Delete/cancel task
- `POST /tasks/:id/upload-proof` - Upload proof image (multipart)
- `GET /tasks/:id/messages` - Get chat messages
- `POST /tasks/:id/messages` - Send chat message
- `POST /tasks/:id/review` - Submit rating/review

### Users (`/users`)
- `GET /users/:id` - Get user profile
- `GET /users/:id/tasks/requested` - Get tasks posted by user
- `GET /users/:id/tasks/assigned` - Get tasks accepted by user
- `GET /users/:id/metrics` - Get user statistics
- `GET /users/:id/wallet` - Get wallet balance

---

## REAL-TIME FEATURES (Socket.IO)

### Events Emitted by Server
- `task_posted` - New task created (broadcast to all taskers)
- `task_assigned` - Task accepted by tasker
- `task_started` - Task started
- `task_completed` - Task marked complete
- `task_paid` - Payment released
- `task_cancelled` - Task cancelled
- `message` - New chat message
- `location_update` - Tasker location update

### Events Received from Client
- `join_tasker` - Join tasker room for notifications
- `location_update` - Send current GPS coordinates
  ```javascript
  { taskId, lat, lng, heading }
  ```

---

## AUTHENTICATION FLOW

1. **Request OTP:**
   - User enters phone number
   - Server generates 6-digit OTP
   - OTP stored in memory with 5-minute expiry
   - Sent via SMS (Twilio) or Email (SMTP)

2. **Verify OTP:**
   - User enters OTP
   - Server validates OTP
   - If valid, generates JWT token
   - Returns token + user data
   - If new user, prompts for name

3. **Authenticated Requests:**
   - Client sends JWT in `Authorization: Bearer <token>` header
   - Server validates JWT and extracts user ID
   - User ID available in `req.user`

---

## TASK LIFECYCLE

```
1. POSTED
   ↓ (tasker accepts)
2. ACCEPTED
   ↓ (tasker starts)
3. IN_PROGRESS
   ↓ (tasker uploads proof)
4. COMPLETED
   ↓ (requester approves)
5. PAID
```

**Alternative Flows:**
- POSTED → CANCELLED (requester deletes)
- ACCEPTED → POSTED (tasker rejects, refund issued)
- IN_PROGRESS → POSTED (requester cancels, refund issued)

---

## PAYMENT FLOW (Stripe Escrow)

1. **Task Creation:**
   - Create Stripe PaymentIntent with `capture_method: manual`
   - Amount held but not captured
   - PaymentIntent ID stored in task

2. **Task Completion:**
   - Tasker uploads proof
   - Task status → 'completed'

3. **Approval:**
   - Requester approves
   - Server captures PaymentIntent
   - Platform fee deducted (10%)
   - Remaining amount credited to tasker wallet
   - Task status → 'paid'

4. **Refund (if cancelled):**
   - Stripe refund issued
   - Transaction status → 'refunded'

---

## LIVE TRACKING SYSTEM

### Frontend (public/app.js)
```javascript
// Start location sharing (every 3 seconds)
function startLocationSharing(taskId) {
  setInterval(() => {
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude, heading, speed } = pos.coords;
      
      // Calculate distance to task location
      const distance = calculateDistance(
        latitude, longitude,
        taskLocation.lat, taskLocation.lng
      );
      
      // Calculate ETA
      const speedKmh = speed ? speed * 3.6 : 30;
      const eta = distance / speedKmh * 60;
      
      // Update HUD
      document.getElementById('distance-hud').textContent = distance.toFixed(2) + ' km';
      document.getElementById('eta-hud').textContent = Math.round(eta) + ' min';
      document.getElementById('speed-hud').textContent = Math.round(speedKmh) + ' km/h';
      
      // Send to server via Socket.IO
      socket.emit('location_update', { taskId, lat: latitude, lng: longitude, heading });
    });
  }, 3000);
}

// Haversine formula for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
```

### HUD Interface
- Full-screen modal with MapLibre GL map
- Floating panels with semi-transparent dark background
- Real-time stats: distance, ETA, speed
- Tasker info: name, phone, rating
- Task info: title, status, price
- Updates every 3 seconds

---

## GEOSPATIAL QUERIES

MongoDB geospatial index on `Task.location`:
```javascript
taskSchema.index({ location: '2dsphere' });
```

Query nearby tasks:
```javascript
Task.find({
  status: 'posted',
  location: {
    $nearSphere: {
      $geometry: { type: 'Point', coordinates: [lng, lat] },
      $maxDistance: radiusKm * 1000 // meters
    }
  }
})
```

---

## SECURITY MEASURES

1. **Rate Limiting:**
   - OTP requests: 5 per 15 minutes per IP
   - Task creation: 10 per hour per user
   - Uses `express-rate-limit` with custom key generator for Vercel

2. **Input Validation:**
   - All inputs validated with Joi schemas
   - Sanitization to prevent XSS/injection

3. **Authentication:**
   - JWT tokens with 30-day expiry
   - Tokens stored in localStorage
   - Middleware validates token on protected routes

4. **Authorization:**
   - Role-based access (requester/tasker/admin)
   - Task ownership checks before edit/delete
   - Tier-based task filtering (basic/pro)

5. **Payment Security:**
   - Stripe handles all card data (PCI compliant)
   - Escrow system prevents fraud
   - Webhook signature verification

6. **Headers:**
   - Helmet.js for security headers
   - CORS enabled for cross-origin requests
   - Compression for performance

---

## ENVIRONMENT VARIABLES

```env
# Server
PORT=4000
NODE_ENV=production

# Database
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/kaamparyo

# Authentication
JWT_SECRET=random_256_bit_string

# Payments
STRIPE_SECRET_KEY=sk_test_...
PLATFORM_FEE_PCT=10

# OTP
OTP_EXPIRY_SECONDS=300
DEBUG_OTP=false

# Email (optional)
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=user@ethereal.email
SMTP_PASS=password
SMTP_FROM=noreply@kaamparyo.com

# Maps
GOOGLE_MAPS_API_KEY=optional_for_geocoding

# Redis (optional)
REDIS_URL=redis://...
DISABLE_REDIS_ADAPTER=true

# Misc
BASE_URL=https://kaamparyo.vercel.app
DEFAULT_RADIUS_KM=100
```

---

## DEPLOYMENT (Vercel)

### Configuration (vercel.json)
```json
{
  "version": 2,
  "builds": [
    { "src": "api/index.js", "use": "@vercel/node" },
    { "src": "public/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "api/index.js" },
    { "src": "/(auth|tasks|users|categories|admin|wallet|settings)/(.*)", "dest": "api/index.js" },
    { "src": "/uploads/(.*)", "dest": "api/index.js" },
    { "src": "/(.*\\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|eot))", "dest": "public/$1" },
    { "src": "/(.*)", "dest": "public/index.html" }
  ]
}
```

### Serverless Entry Point (api/index.js)
```javascript
const mongoose = require('mongoose');
const app = require('../src/app');

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }
  const db = await mongoose.connect(process.env.MONGO_URI);
  cachedDb = db;
  return db;
}

module.exports = async (req, res) => {
  await connectToDatabase();
  return app(req, res);
};
```

**Note:** Socket.IO doesn't work on Vercel serverless. Real-time features are optional and gracefully degrade.

---

## FRONTEND ARCHITECTURE

### Single Page Application (public/index.html)
- No framework, vanilla JavaScript
- Bootstrap 5 for UI components
- Galli Maps API for Nepal-specific mapping with Leaflet
- Socket.IO client for real-time updates

### State Management
```javascript
let token = localStorage.getItem('token');
let currentUser = null;
let taskerLocation = { lat: 27.7172, lng: 85.3240 }; // Kathmandu default
let selectedLocation = { lat: 27.7172, lng: 85.3240 };
let socket = null;
```

### Key Functions
- `showLogin()` - Display login modal
- `requestOTP()` - Request OTP via API
- `verifyOTP()` - Verify OTP and get JWT
- `loadUser()` - Fetch current user profile
- `enterApp()` - Initialize dashboard
- `loadMyTasks()` - Fetch user's posted tasks
- `loadNearbyTasks()` - Fetch tasks within radius
- `openLiveTracking(taskId)` - Open HUD modal
- `startLocationSharing(taskId)` - Begin GPS updates
- `calculateDistance()` - Haversine formula

---

## INSTALLATION

### Prerequisites
- Node.js 16+
- MongoDB database
- Stripe account (for payments)

### Local Setup

1. Clone repository
```bash
git clone https://github.com/yourusername/kaamparyo.git
cd kaamparyo
```

2. Install dependencies
```bash
npm install
```

3. Configure environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. Start server
```bash
npm start
```

5. Open browser
```
http://localhost:4000
```

---

## KNOWN LIMITATIONS

1. **Socket.IO on Vercel:**
   - Doesn't work on serverless
   - Real-time features degrade gracefully
   - Consider using Pusher or Ably for production

2. **File Uploads:**
   - Stored locally in `/uploads`
   - Not persistent on Vercel
   - Should use S3/Cloudinary for production

3. **OTP Delivery:**
   - Currently uses Ethereal (fake SMTP)
   - Needs real SMS provider (Twilio) for production

4. **Payment Processing:**
   - Demo mode (no real charges)
   - Needs Stripe live keys for production

---

## GALLI MAPS INTEGRATION

### Overview
KaamParyo uses **Galli Maps Vector Plugin**, a Nepal-specific mapping service that provides accurate location data, routing, and geocoding for Nepal.

### Plugin Integration
```html
<script src="https://gallimap.com/static/dist/js/gallimaps.vector.min.latest.js"></script>
```

### API Key
```
GALLI_MAPS_API_KEY=urle63a1458-7833-4b82-b946-19e4ef1f1138
```

### Available Endpoints

#### 1. Autocomplete Search
```
GET /maps/autocomplete?word=kathmandu&lat=27.7172&lng=85.3240
```
Returns location suggestions as user types.

#### 2. Location Search
```
GET /maps/search?name=Thamel&currentLat=27.7172&currentLng=85.3240
```
Returns coordinates for a location name.

#### 3. Reverse Geocoding
```
GET /maps/reverse?lat=27.7172&lng=85.3240
```
Returns address details from coordinates.

#### 4. Routing
```
GET /maps/route?srcLat=27.7172&srcLng=85.3240&dstLat=27.7000&dstLng=85.3200&mode=driving
```
Returns route with distance, duration, and path coordinates.

#### 5. Distance Calculation
```
GET /maps/distance?srcLat=27.7172&srcLng=85.3240&dstLat=27.7000&dstLng=85.3200&mode=walking
```
Returns distance and duration between two points.

### Frontend Integration

**Initialize Map:**
```javascript
const galliMapsObject = {
    accessToken: 'YOUR_ACCESS_TOKEN',
    map: {
        container: 'map',
        center: [27.7172, 85.3240], // [lat, lng]
        zoom: 15,
        maxZoom: 25,
        minZoom: 5,
        clickable: true
    },
    customClickFunctions: [handleMapClick]
};

const map = new GalliMapPlugin(galliMapsObject);
```

**Add Marker:**
```javascript
const pinMarkerObject = {
    color: "#FBBF24",
    draggable: true,
    latLng: [27.7172, 85.3240]
};

const marker = map.displayPinMarker(pinMarkerObject);
```

**Autocomplete Search:**
```javascript
const results = await map.autoCompleteSearch('Kathmandu');
// Returns array of location suggestions
```

**Search Location:**
```javascript
await map.searchData('Thamel');
// Automatically displays location on map
```

**Remove Marker:**
```javascript
map.removePinMarker(marker);
```

### Features
- **Vector Maps**: High-performance vector-based maps
- **Nepal-Specific Data**: Accurate addresses with ward numbers, municipalities, and districts
- **Interactive Markers**: Draggable, colored pin markers
- **Autocomplete Search**: Fast location suggestions
- **Location Search**: Find places and display on map
- **Custom Click Events**: Handle map clicks with custom functions
- **Polygon/LineString Support**: Draw custom shapes on map
- **Routing**: Walking, cycling, and driving routes (via API)
- **Distance Calculation**: Real-time distance and ETA (via API)

---

## LICENSE

MIT License - Free for personal and commercial use.

---

**This README is designed for AI comprehension. All technical details, data flows, and implementation specifics are documented for autonomous understanding and potential code generation.**
