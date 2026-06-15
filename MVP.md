# 🎯 Chiến lược MVP (Nâng cấp AI) - Dự án Marekto

Dự án **Marekto** là một hệ thống **AI-Powered Marketing Automation & Lead Management** (Quản lý và Tự động hóa Tiếp thị tích hợp Trí tuệ Nhân tạo). Hệ thống tận dụng tối đa sức mạnh lưu trữ cấu trúc động của **PostgreSQL (Porgle)** qua trường `JSONB` kết hợp với các mô hình ngôn ngữ lớn (LLM) chạy local qua **Ollama** để tự động hóa hoàn toàn luồng xử lý dữ liệu tiếp thị.

Giai đoạn MVP tập trung giải quyết triệt để 3 trục tính năng cốt lõi mang tính đột phá, loại bỏ hoàn toàn các rào cản vận hành truyền thống.

---

## 💎 1. Các Tính Năng Cốt Lõi Dự Kiến (MVP Scope)

### 👥 1.1. Quản lý Khách hàng Động & AI Chấm Điểm (Dynamic Contacts & AI Lead Scoring)
* **Lưu trữ linh hoạt:** Lưu các trường thông tin cơ bản định danh (`id`, `email`, `first_name`, `last_name`, `phone`). Toàn bộ các thuộc tính hành vi, siêu dữ liệu động được đẩy vào một cột duy nhất là **`properties` (Kiểu `JSONB`)**.
* **AI Agent xử lý ngầm (Embedded AI Scoring):** Khi dữ liệu khách hàng thô được nạp vào hệ thống, một AI Agent (chạy qua Ollama) sẽ lập tức bóc tách dữ liệu, phân tích hồ sơ và tự động tính toán điểm số tiềm năng (`lead_score`), đồng thời gán nhãn phân loại (Ví dụ: `{"lead_score": 95, "tags": ["VIP", "Tech-Savy"], "city": "HCM"}`) trực tiếp vào trường `properties` mà không cần cấu hình lại cấu trúc database.

### 🤖 1.2. Bộ Lọc Phân Khúc Bằng Tiếng Người (AI Smart Segmentation)
* **Trải nghiệm ngôn ngữ tự nhiên:** Người dùng không cần biết viết câu lệnh SQL phức tạp hay thao tác click dựng cấu trúc logic cồng kềnh.
* **Cơ chế biên dịch của AI:** Người dùng chỉ cần nhập một câu lệnh bằng ngôn ngữ tự nhiên (Ví dụ: *"Tìm cho tôi danh sách khách hàng VIP ở Hồ Chí Minh có điểm tiềm năng trên 80"*). AI Agent sẽ chịu trách nhiệm biên dịch câu nói này thành một cấu trúc Object bộ lọc JSON chuẩn chỉnh (Ví dụ: `{"city": "HCM", "lead_score_gt": 80, "tags_contains": "VIP"}`). 
* **Lưu trữ bộ lọc:** Object JSON này được lưu trữ trực tiếp vào trường **`target_filters` (Kiểu `JSONB`)** bên trong bảng `campaigns`.

### ⏳ 1.3. Tự Động Hóa Thực Thi & Cá Nhân Hóa Sâu (Automation & AI Hyper-Personalization)
* **Tiến trình quét ngầm (Cron Engine):** Thư viện `node-cron` thiết lập các vòng lặp quét database theo thời gian thực để tìm kiếm các chiến dịch đến lịch phát hành (`run_at`) có trạng thái `scheduled`.
* **AI Generate Email Content:** Trước khi gửi, thay vì sử dụng các mẫu email (Template) tĩnh nhàm chán, hệ thống sẽ bốc tách thông tin cá nhân của từng Contact trong bảng dữ liệu, chuyển qua AI Agent để sinh ra nội dung Email cá nhân hóa độc bản dựa trên hồ sơ của chính khách hàng đó.
* **Hạ tầng phân phối:** Thư viện `nodemailer` tiếp nhận nội dung Email độc bản đã được AI tối ưu để thực hiện bắt tay qua giao thức SMTP gửi trực tiếp tới hòm thư của khách hàng.

---

## 🛠️ 2. Hệ Thống Công Nghệ (Tech Stack MVP)

| Thành phần | Công nghệ lựa chọn | Vai trò trong hệ thống |
| :--- | :--- | :--- |
| **Framework** | Next.js 15+ (App Router) | Xây dựng kiến trúc Full-stack, xử lý API Route Handlers siêu tốc |
| **Language** | TypeScript | Quản lý chặt chẽ cấu trúc dữ liệu JSON, đồng bộ Type an toàn |
| **Database** | PostgreSQL (Porgle) | Lưu trữ lõi. Tối ưu hóa hiệu năng quét mảng dữ liệu qua chỉ mục **GIN Index** trên các trường JSONB (`properties` và `target_filters`) |
| **Database Driver**| `pg` (node-postgres) | Khởi tạo **Connection Pool** kết nối trực tiếp, quản lý tài nguyên tối ưu dưới máy Local |
| **Local AI Engine** | **Ollama (Llama 3 / Qwen)** | Vận hành offline 100%, bảo mật tuyệt đối dữ liệu khách hàng, xử lý chấm điểm và sinh nội dung thư |
| **Task Runner** | `node-cron` | Bộ đếm thời gian kích hoạt tiến trình tự động chạy ngầm |
| **Mailer Client** | `nodemailer` | Giao tiếp SMTP để phân phối mail tự động |

---

## 📉 3. Chỉ Số Thành Công Của Giai Đoạn MVP
1. **Zero-Migration Expansion:** Thêm mới hơn 20 thuộc tính khách hàng động mà không cần thực hiện bất kỳ lệnh `ALTER TABLE` nào, hệ thống vẫn truy vấn mượt mà.
2. **AI Translation Accuracy:** Thử nghiệm AI dịch đúng 95% các câu lệnh tiếng người thông thường thành cấu trúc logic Object Filter JSON.
3. **GIN Index Query Performance:** Câu lệnh quét phân khúc khách hàng động lồng trong trường JSONB với tập dữ liệu mẫu đạt tốc độ xử lý dưới 50ms.