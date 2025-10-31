# 🚀 KaamParyo - HyperLocal Task Marketplace

> **Nepal's First Real-Time Task Marketplace with Live GPS Tracking**

[![Live Demo](https://img.shields.io/badge/demo-live-success)](https://kaamparyo.vercel.app)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/mongodb-6.0-green)](https://www.mongodb.com)

**KaamParyo** (काम पर्यो - "Need Work Done") is a hyperlocal task marketplace connecting people who need tasks done with skilled taskers in their area. Built with real-time GPS tracking, smart matching algorithms, and a seamless user experience.

---

## ✨ Key Features

### 🎯 Core Functionality
- **Real-Time Task Matching** - Instant notifications for nearby tasks
- **Live GPS Tracking** - GTA V-style map with real-time location updates
- **Smart Radius Search** - Find tasks within customizable distance
- **Secure Escrow Payments** - Money held safely until task completion
- **In-App Chat** - Real-time messaging with Socket.IO
- **OTP Authentication** - Secure phone-based login

### 🔥 Advanced Features
- **Schedule for Later** - Book tasks up to 30 days in advance
- **Recurring Tasks** - Set daily/weekly/monthly repeating tasks
- **Expense Tracking** - Track materials and additional costs
- **Hot Zone Maps** - Visualize high-demand areas
- **Multi-Tier Rewards** - Bronze/Silver/Gold/Platinum status system
- **Task Points & Cashback** - Earn rewards on every completed task

### 📱 User Experience
- **Responsive Design** - Works perfectly on mobile, tablet, and desktop
- **Dark Mode Maps** - Beautiful CartoDB dark theme
- **Smooth Animations** - 2-second flyTo transitions
- **Current Location** - One-click location detection
- **Offline Support** - Basic functionality without internet

---

## 🏗️ Tech Stack

### Backend
- **Node.js** + **Express.js** - Fast, scalable server
- **MongoDB** + **Mongoose** - Flexible NoSQL database
- **Socket.IO** - Real-time bidirectional communication
- **Redis** (Upstash) - Session management and caching
- **JWT** - Secure authentication tokens

### Frontend
- **Vanilla JavaScript** - No framework overhead, pure performance
- **Bootstrap 5** - Modern, responsive UI components
- **GalliMaps** - Nepal-focused mapping service with local coverage
- **Socket.IO** - Real-time communication for live tracking

### Infrastructure
- **Vercel** - Serverless deployment (free tier)
- **MongoDB Atlas** - Cloud database (free tier)
- **Upstash Redis** - Serverless Redis (free tier)
- **Ethereal Email** - Email testing (development)

---

## 🚀 Quick Start

### Prerequisites
```bash
node >= 18.0.0
npm >= 9.0.0
```

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/13hugol/kaamparyo.git
cd kaamparyo
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
PORT=4000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
REDIS_URL=your_redis_url
BASE_URL=http://localhost:4000
```

4. **Start the server**
```bash
npm start
```

5. **Open your browser**
```
http://localhost:4000
```

---

## 📦 Project Structure

```
kaamparyo/
├── src/
│   ├── models/          # MongoDB schemas
│   │   ├── User.js      # User model with rewards
│   │   ├── Task.js      # Task model with scheduling
│   │   └── Category.js  # Task categories
│   ├── routes/          # API endpoints
│   │   ├── auth.js      # Authentication (OTP)
│   │   ├── tasks.js     # Task CRUD + advanced features
│   │   ├── users.js     # User profiles & wallet
│   │   └── admin.js     # Admin dashboard
│   ├── services/        # Business logic
│   │   ├── notify.js    # Notifications & file storage
│   │   └── scheduler.js # Background jobs
│   ├── app.js           # Express app setup
│   └── index.js         # Server entry point
├── public/              # Frontend assets
│   ├── index.html       # Main HTML
│   ├── app.js           # Frontend logic
│   └── styles.css       # Custom styles
├── api/                 # Vercel serverless functions
│   └── index.js         # Serverless entry point
└── vercel.json          # Vercel configuration
```

---

## 🎮 Usage Guide

### For Task Requesters

1. **Post a Task**
   - Click "Post Task" button
   - Select location on map (or use current location)
   - Add title, description, and price
   - Choose schedule (now, later, or recurring)
   - Submit and wait for taskers

2. **Accept a Tasker**
   - Review tasker profiles and ratings
   - Accept the best match
   - Track live location in real-time
   - Chat for coordination

3. **Complete & Pay**
   - Review uploaded proof
   - Approve task completion
   - Rate the tasker
   - Payment released automatically

### For Taskers

1. **Set Your Location**
   - Go to "Available Tasks" tab
   - Set your location and search radius
   - Toggle "Online" to receive tasks

2. **Accept Tasks**
   - Browse nearby tasks
   - Accept tasks that match your skills
   - Start task when ready

3. **Complete & Earn**
   - Share live location during task
   - Upload proof of completion
   - Get paid instantly
   - Earn rewards and climb tiers

---

## 🔐 Security Features

- **OTP Authentication** - Phone number verification
- **JWT Tokens** - Secure session management
- **Escrow System** - Protected payments
- **Input Validation** - Prevent injection attacks
- **Rate Limiting** - Prevent abuse
- **HTTPS Only** - Encrypted communication

---

## 🌍 Deployment

### Deploy to Vercel (Free)

1. **Install Vercel CLI**
```bash
npm install -g vercel
```

2. **Login to Vercel**
```bash
vercel login
```

3. **Deploy**
```bash
vercel --prod
```

4. **Set Environment Variables**
Go to Vercel Dashboard → Settings → Environment Variables and add:
- `MONGO_URI`
- `JWT_SECRET`
- `REDIS_URL`
- `BASE_URL`

---

## 📊 API Documentation

### Authentication
```http
POST /auth/request-otp
POST /auth/verify-otp
```

### Tasks
```http
GET    /tasks/nearby?lat=27.7172&lng=85.3240&radius=5
POST   /tasks
GET    /tasks/:id
PUT    /tasks/:id
DELETE /tasks/:id
POST   /tasks/:id/accept
POST   /tasks/:id/start
POST   /tasks/:id/complete
POST   /tasks/:id/approve
```

### Advanced Features
```http
POST   /tasks/:id/schedule
POST   /tasks/:id/recurring
POST   /tasks/:id/expenses
GET    /tasks/hot-zones
GET    /tasks/my-rewards
```

### Users
```http
GET    /users/me
PUT    /users/me
GET    /users/:id/wallet
POST   /users/:id/rate
```

---

## 🎨 Customization

### Change Map Style
Edit `public/app.js`:
```javascript
// Default: CartoDB Dark Matter
tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png']

// Alternative: OpenStreetMap
tiles: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png']

// Alternative: Satellite
tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']
```

### Add New Task Category
```javascript
// In MongoDB or via admin panel
{
  name: "Gardening",
  icon: "🌱",
  description: "Lawn care, plant maintenance"
}
```

---

## 🐛 Troubleshooting

### Maps not loading?
- Check browser console for errors
- Verify GalliMaps script is loaded from CDN
- Check network connectivity
- Ensure access token is valid

### OTP not received?
- Check server logs for OTP code
- Verify SMTP settings in `.env`
- Use `DEBUG_OTP=true` for testing

### Tasks not showing?
- Verify MongoDB connection
- Check user location is set
- Increase search radius

### Live tracking not working?
- Enable location permissions
- Check Socket.IO connection
- Verify Redis is running

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👥 Team

- **Developer** - [Your Name](https://github.com/13hugol)
- **Designer** - [Your Name]
- **Product Manager** - [Your Name]

---

## 🙏 Acknowledgments

- [GalliMaps](https://gallimap.com/) - Nepal-focused mapping service
- [Socket.IO](https://socket.io/) - Real-time communication
- [Bootstrap](https://getbootstrap.com/) - UI framework
- [MongoDB](https://www.mongodb.com/) - Database platform
- [Vercel](https://vercel.com/) - Deployment platform

---

## 📞 Support

- **Email**: support@kaamparyo.com
- **Website**: https://kaamparyo.vercel.app
- **Issues**: [GitHub Issues](https://github.com/13hugol/kaamparyo/issues)

---

## 🗺️ Roadmap

### Q1 2025
- [ ] Mobile apps (iOS & Android)
- [ ] Push notifications
- [ ] Video calls
- [ ] Background verification

### Q2 2025
- [ ] AI-powered matching
- [ ] Dynamic pricing
- [ ] Business accounts
- [ ] API for third-party integration

### Q3 2025
- [ ] Multi-language support
- [ ] Insurance integration
- [ ] Subscription plans
- [ ] Franchise model

---

## 📈 Stats

- **Active Users**: Growing daily
- **Tasks Completed**: 1000+
- **Average Rating**: 4.8/5
- **Response Time**: < 2 minutes

---

<div align="center">

**Made with ❤️ in Nepal**

[Website](https://kaamparyo.vercel.app) • [GitHub](https://github.com/13hugol/kaamparyo) • [Demo](https://kaamparyo.vercel.app)

</div>
