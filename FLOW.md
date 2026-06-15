# 🔄 Luồng Nghiệp Vụ Toàn Diện (Tích Hợp AI) - Dự án Marekto

Tài liệu này mô tả chi tiết đường đi của dữ liệu (Data Journey), cách thức các AI Agent can thiệp vào hệ thống ngầm và kiến trúc lưu trữ thực tế trên Database **PostgreSQL (Porgle)**.

---

## 📊 1. Kiến Trúc Luồng Di Chuyển Dữ Liệu (AI & Data Flow)

```text
  [ Dữ liệu khách hàng thô ] (Từ API / Form đăng ký)
               │
               ▼
  ┌────────────────────────────────────────┐
  │      Stage 2: AI Lead Scoring Agent    │ -> Phân tích dữ liệu bằng LLM (Ollama)
  └────────────────────┬───────────────────┘
                       │
                       ▼ (Bổ sung điểm số & nhãn gán tự động)
  ┌────────────────────────────────────────┐
  │     Table: contacts (PostgreSQL)       │ -> Trường properties (JSONB) [Có GIN Index]
  └────────────────────────────────────────┘
                       ▲
                       │ (Truy vấn phân khúc động bằng toán tử SQL JSONB)
  ┌────────────────────┴───────────────────┐
  │        Stage 5: Node-Cron Runner       │ -> Tiến trình ngầm trigger tự động theo lịch
  └────────────────────▲───────────────────┘
                       │
                       │ (Quét các chiến dịch có status = 'scheduled' & run_at <= NOW)
  ┌────────────────────┴───────────────────┐
  │     Table: campaigns (PostgreSQL)      │ -> Lưu target_filters (JSONB) [Có GIN Index]
  └────────────────────▲───────────────────┘
                       │
  [ Người dùng nhập câu lệnh tiếng người ] ──> [ AI Smart Segmentation ] (Dịch sang Filter JSON)
```

---

## 📝 2. Chi Tiết Các Bước Vận Hành Trong Luồng Hệ Thống

### ▫️ Bước 1: Tiếp nhận Dữ liệu Thô (Data Ingestion)
Khách hàng điền form, hoặc hệ thống thực hiện import danh sách data thô vào API Route `/api/contacts`. Lúc này dữ liệu chỉ có các thông tin cơ bản chưa được phân loại sâu.

### ▫️ Bước 2: AI Chấm điểm & Gắn nhãn tự động (AI Lead Scoring & Tagging)
Trước khi lưu vào database, Next.js Backend bắn dữ liệu thô này sang **Ollama AI Local Agent**.
* **AI phân tích:** Đọc email, chức danh, hành vi để nhận diện mức độ tiềm năng.
* **Đóng gói dữ liệu:** AI nhả ra cấu trúc JSON bao gồm `lead_score`, `tags` và các trường phụ.
```json
{
  "city": "HCM",
  "tags": ["VIP", "Developer"],
  "lead_score": 95
}
```

### ▫️ Bước 3: Lưu trữ thông tin động vào PostgreSQL (Contact Storage)
Toàn bộ object JSON do AI sinh ra ở Bước 2 được đẩy thẳng vào cột `properties` của bảng `contacts`. Nhờ cấu hình chỉ mục **GIN Index** trên cột này, dữ liệu được sắp xếp tối ưu, sẵn sàng cho các câu lệnh quét phân khúc tốc độ cao.

### ▫️ Bước 4: Cấu hình Chiến dịch bằng Ngôn ngữ tự nhiên (AI Campaign Setup)
1. Người dùng vào giao diện điều khiển, tạo Campaign mới và gõ yêu cầu mong muốn: *"Gửi mail khuyến mãi cho tất cả contact VIP ở HCM"*.
2. **AI Smart Segmentation App** tiếp nhận, dịch câu nói này thành cấu trúc logic bộ lọc:
   ```json
   {
     "city": "HCM",
     "lead_score_gt": 50,
     "tags_contains": "VIP"
   }
   ```
3. Bản ghi được lưu vào bảng `campaigns` với cột `target_filters` chứa object JSON trên, đặt lịch phát hành tại cột `run_at` và gắn trạng thái `status = 'scheduled'`.

### ▫️ Bước 5: Tiến trình quét ngầm và Thực thi Tự động (Automated Execution)
1. Thư viện `node-cron` chạy ngầm mỗi phút một lần, thực hiện quét bảng `campaigns` để tìm các chiến dịch đã đến giờ kích hoạt.
2. Hệ thống bốc bộ lọc `target_filters` ra, tự động chuyển đổi thành một câu lệnh truy vấn PostgreSQL bóc tách trường dữ liệu JSONB động:
   ```sql
   SELECT email, first_name, properties FROM contacts 
   WHERE properties->>'city' = 'HCM' AND (properties->>'lead_score')::int > 50;
   ```
3. Sau khi Postgres trả ra mảng danh sách các khách hàng trùng khớp, hệ thống duyệt qua từng khách hàng, gửi thông tin cá nhân của họ vào **AI Hyper-Personalization Agent** để tự động viết nội dung Email riêng biệt (Cá nhân hóa nội dung theo ngữ cảnh).
4. Nội dung thư độc bản được chuyển sang **Nodemailer** để thực hiện phân phối qua SMTP. Chiến dịch chuyển trạng thái sang `completed`.

---

## 🗄️ 3. Mô hình Cấu trúc Database PostgreSQL (Porgle Schema)

Dưới đây là cấu trúc SQL chuẩn chỉnh đã được thiết kế tối ưu hóa cho luồng vận hành AI trên, sẵn sàng để bạn chạy trực tiếp trong Query Tool:

```sql
-- Khởi tạo bảng lưu trữ Khách hàng (Contacts)
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    
    -- Cột lõi chứa toàn bộ metadata động và dữ liệu do AI chấm điểm
    properties JSONB DEFAULT '{}'::jsonb, 
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Khởi tạo bảng lưu trữ Chiến dịch (Campaigns)
CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft', -- draft, scheduled, running, completed
    
    -- Cột lưu cấu hình bộ lọc do AI dịch từ tiếng người ra JSON
    target_filters JSONB DEFAULT '{}'::jsonb, 
    
    run_at TIMESTAMPTZ, -- Mốc thời gian kích hoạt hệ thống gửi tự động
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Thiết lập chỉ mục GIN (Generalized Inverted Index) - Chìa khóa vàng để tối ưu tốc độ quét dữ liệu JSONB nâng cao
CREATE INDEX IF NOT EXISTS idx_contacts_properties_gin ON contacts USING gin (properties);
CREATE INDEX IF NOT EXISTS idx_campaigns_filters_gin ON campaigns USING gin (target_filters);
```