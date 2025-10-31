const { v4: uuidv4 } = require('uuid');

// FREE Mock Payment Service (replace with actual payment gateway later)
// For MVP/testing: simulates payment without real transactions

const mockPayments = new Map(); // In-memory payment storage

module.exports = {
  createPaymentIntent: async ({ amount, currency = 'NPR', metadata = {} }) => {
    // Simulate payment intent creation
    const paymentIntent = {
      id: `pi_mock_${uuidv4()}`,
      amount,
      currency,
      status: 'requires_capture',
      capture_method: 'manual',
      metadata,
      created: Date.now()
    };
    
    mockPayments.set(paymentIntent.id, paymentIntent);
    
    console.log(`💰 Mock Payment Intent Created: ${paymentIntent.id} for ${amount} ${currency}`);
    return paymentIntent;
  },
  
  capturePaymentIntent: async (paymentIntentId) => {
    let pi = mockPayments.get(paymentIntentId);
    
    if (!pi) {
      // Server may have restarted; synthesize a successful capture to keep demo flow unblocked
      pi = {
        id: paymentIntentId,
        amount: 0,
        currency: 'NPR',
        status: 'succeeded',
        captured: true,
        capturedAt: Date.now(),
        created: Date.now()
      };
      console.warn(`⚠️ Mock capture: payment intent not found in memory, synthesizing success for ${paymentIntentId}`);
      mockPayments.set(paymentIntentId, pi);
      return pi;
    }
    
    if (pi.status !== 'requires_capture') {
      // Idempotent: if already succeeded or refunded, return as-is
      console.log(`ℹ️ Mock capture idempotent for ${paymentIntentId} (status=${pi.status})`);
      return pi;
    }
    
    pi.status = 'succeeded';
    pi.captured = true;
    pi.capturedAt = Date.now();
    
    mockPayments.set(paymentIntentId, pi);
    
    console.log(`✅ Mock Payment Captured: ${paymentIntentId}`);
    return pi;
  },
  
  refundPayment: async (paymentIntentId, amount = null) => {
    let pi = mockPayments.get(paymentIntentId);
    
    if (!pi) {
      // Synthesize refund path if missing
      pi = { id: paymentIntentId, amount: amount || 0, status: 'refunded', created: Date.now(), refunded: true };
      mockPayments.set(paymentIntentId, pi);
      console.warn(`⚠️ Mock refund: payment intent not found in memory, synthesizing refund for ${paymentIntentId}`);
    }
    
    const refund = {
      id: `re_mock_${uuidv4()}`,
      payment_intent: paymentIntentId,
      amount: amount || pi.amount,
      status: 'succeeded',
      created: Date.now()
    };
    
    pi.refunded = true;
    pi.status = 'refunded';
    mockPayments.set(paymentIntentId, pi);
    
    console.log(`🔄 Mock Payment Refunded: ${paymentIntentId}`);
    return refund;
  },
  
  // Helper to get payment status (for testing)
  getPaymentIntent: async (paymentIntentId) => {
    return mockPayments.get(paymentIntentId);
  }
};
