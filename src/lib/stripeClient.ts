import { loadStripe } from '@stripe/stripe-js';

const publishableKey = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;

export const hasStripeKey = Boolean(publishableKey);
export const stripePromise = publishableKey ? loadStripe(publishableKey) : null;
