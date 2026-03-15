# Rawer — Plain Text Editor 📝

A minimalist raw plain-text editor. Paste anything, get clean text.

[🇻🇳 Tiếng Việt](#tiếng-việt) | [🇬🇧 English](#english)

---

## Tiếng Việt

**Rawer** là trình soạn thảo văn bản thuần túy (plain text) tối giản, chạy trực tiếp trên trình duyệt. Phù hợp cho việc ghi chú nhanh, xóa định dạng văn bản (khi paste), thao tác trực tiếp và quản lý các file văn bản nhỏ lẻ mà không cần cài đặt phần mềm phức tạp.

### ✨ Tính năng nổi bật

*   **Soạn thảo văn bản thuần:** Tự động loại bỏ mọi định dạng (in đậm, in nghiêng, màu sắc...) khi dán văn bản.
*   **Quản lý File & Thư mục:** Tạo, đổi tên, xóa và tổ chức các tệp và thư mục trên thanh Sidebar. Hỗ trợ sắp xếp thủ công hoặc tự động.
*   **Thanh công cụ đầy đủ:** Hoàn tác, Làm lại, Sao chép, Dán, Xóa toàn bộ văn bản chỉ với một cú nhấp chuột.
*   **Tìm kiếm & Thay thế (Ctrl+H):** Hỗ trợ tìm kiếm cơ bản, phân biệt hoa/thường và cả Biểu thức chính quy (Regex).
*   **Công cụ tiện ích:**
    *   **Hiển thị khoảng trắng:** Giúp kiểm soát số lượng khoảng trắng hoặc tab ẩn.
    *   **Đánh số dòng (Line Numbers):** Theo dõi chính xác vị trí dòng của văn bản dài.
    *   **Bàn phím ảo:** Hỗ trợ gõ các chữ cái tiếng Việt và dấu câu trong trường hợp thiết bị không cài bộ gõ phù hợp.
    *   **Hẹn giờ & Báo thức:** Tích hợp bộ đếm giờ (đếm ngược & báo thức) thông minh có âm báo và popup thông báo.
    *   **Thống kê sử dụng:** Theo dõi số từ, số ký tự, số dòng, cùng với bảng thống kê lịch sử như số phiên & thời gian sử dụng.
*   **Lưu trữ & Xuất/Nhập Dữ liệu:**
    *   Mọi thay đổi tự động được lưu trữ ngay trên trình duyệt (cập nhật offline).
    *   Hỗ trợ tải xuống file văn bản hiện tại.
    *   Trích xuất (Export) và Nhập (Import) toàn bộ Workspace (tất cả các file + cài đặt) dưới dạng file `.json` để sao lưu hoặc đồng bộ sang máy khác.

### 🚀 Cài đặt & Sử dụng

Giao diện hoàn toàn tĩnh được xây dựng từ HTML, CSS, JavaScript thuần (Vanilla). Không cần cài đặt bất kỳ framework nào!

1.  Clone repository này:
    ```bash
    git clone https://github.com/NhanAZ/rawer.git
    ```
2.  Mở thư mục chứa mã nguồn.
3.  Click đúp vào file `index.html` để chạy trực tiếp trên trình duyệt của bạn (Chrome, Firefox, Safari, Edge...).
4.  Hoặc sử dụng phần mềm tạo server tĩnh (ví dụ: Live Server trong VSCode) nếu muốn trải nghiệm tốt nhất trên localhost.

---

## English

**Rawer** is a minimalist plain-text editor built for your browser. It allows you to swiftly jot down notes, strip text formatting when pasting, manipulate text, and manage minor text files without installing bulky software.

### ✨ Key Features

*   **Raw Plain Text:** Automatically strips text of any rich formatting (bold, italics, colours, links) upon pasting.
*   **File & Folder Management:** Create, rename, delete, and organize files and folders via the Sidebar. Supports manual and automatic sorting modes.
*   **Essential Editor Tools:** Quick access to Undo, Redo, Copy, Paste, and Clear Document right from the toolbar.
*   **Find & Replace (Ctrl+H):** Complete search capability supporting case-matching and Regular Expressions (Regex).
*   **Built-in Utilities:**
    *   **Show Spaces:** Easily spot hidden tabs and trailing spaces.
    *   **Line Number Gutter:** Keep track of your cursor line in larger files.
    *   **Virtual Keyboard:** Includes special Vietnamese characters and diacritics.
    *   **Timer & Alarm:** Built-in countdown and alarm tools customized with popups, sounds, and repeat functions.
    *   **Usage Stats:** Live tracking of characters, words, and lines. Comprehensive stats overview spanning multiple sessions.
*   **Data Saving & Persistence:**
    *   Auto-saves entirely within your browser (Offline storage).
    *   Download your currently opened file locally.
    *   Export and Import your entire Workspace (files, configurations) as a `.json` file for backup/syncing.

### 🚀 Getting Started

No build tools are required! This consists of vanilla HTML, CSS, and JS.

1.  Clone this repository:
    ```bash
    git clone https://github.com/NhanAZ/rawer.git
    ```
2.  Navigate into the directory.
3.  Open the `index.html` file using your web browser of choice (Chrome, Firefox, Safari, Edge...).
4.  Alternatively, you can serve it via a local static web server (e.g., VSCode's Live Server).

### 🛠️ Technology Stack

*   **HTML5**
*   **CSS3** (Custom Styles, Flexbox, CSS Variables)
*   **JavaScript** (Vanilla JS, DOM APIs, LocalStorage)
