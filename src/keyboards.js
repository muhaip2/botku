--- a/src/keyboards.js
+++ b/src/keyboards.js
@@
 // (fungsi & export lain tetap)
 
+// Helper: bikin tombol yang mengirim command via callback OPEN_CMD|
+const mkCmdBtn = (label, command) => ({
+  text: label,
+  callback_data: `OPEN_CMD|${command}`
+});
+
 export function K_ADMIN() {
-  return {
-    reply_markup: {
-      inline_keyboard: [
-        [{ text: '📰 Broadcast', callback_data: 'OPEN_CMD|/broadcast' }],
-        [{ text: '📊 Stats 7 Hari', callback_data: 'OPEN_CMD|/stats7' }],
-        [{ text: '🧰 Kelola Pool Proxy', callback_data: 'OPEN_CMD|/pool' }],
-        [{ text: '⬅️ Kembali', callback_data: 'OPEN_CMD|/menu' }]
-      ]
-    }
-  };
+  return {
+    reply_markup: {
+      inline_keyboard: [
+        [ mkCmdBtn('📰 Broadcast', '/broadcast') ],
+        [ mkCmdBtn('📊 Stats 7 Hari', '/stats7') ],
+        [ mkCmdBtn('🧰 Kelola Pool Proxy', '/pool') ],
+        // ===== Tambahan tombol admin untuk cek user =====
+        [ mkCmdBtn('📄 List Users', '/list_users') ],
+        [ mkCmdBtn('🔎 User Detail', '/userdetail') ],
+        // =================================================
+        [ mkCmdBtn('⬅️ Kembali', '/menu') ]
+      ]
+    }
+  };
 }
 
 // Eksport lain tetap
