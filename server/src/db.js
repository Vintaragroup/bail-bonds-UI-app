import mongoose from 'mongoose';

export async function connectMongo(uri, dbName) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName, maxPoolSize: 10 });
  mongoose.connection.on('connected', () => console.log('🟢 Mongo connected'));
  mongoose.connection.on('error', (e) => console.error('🔴 Mongo error:', e));
}