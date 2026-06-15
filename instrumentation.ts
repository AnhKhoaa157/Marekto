// src/instrumentation.ts
import { initializeDatabase } from '@/lib/db';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log("🚀 Server starting: Initializing Marekto Database...");
    try {
      await initializeDatabase();
      console.log("✅ Database initialized successfully during startup!");
    } catch (error) {
      console.error("❌ Failed to initialize database on startup:", error);
      // Bạn có thể chọn process.exit(1) nếu muốn dừng server khi DB lỗi
    }
  }
}