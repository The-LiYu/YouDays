package com.youri.anniversary;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 优日：让 WebView 铺满屏幕（edge-to-edge），再用系统栏 insets 给内容留出安全距离。
 * 输入法键盘交给 adjustResize 处理——不能再加一次 IME 底部 padding，否则键盘弹出时
 * WebView 会被压缩两次，页面只剩顶部一小条。
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(Color.parseColor("#F6F2EB")));
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        WindowCompat.setDecorFitsSystemWindows(window, false);
        WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightNavigationBars(true);

        View content = findViewById(android.R.id.content);
        if (content instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) content;
            for (int i = 0; i < group.getChildCount(); i++) {
                final View child = group.getChildAt(i);
                ViewCompat.setOnApplyWindowInsetsListener(child, (view, insets) -> {
                    Insets bars = insets.getInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                    );
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                    return insets;
                });
                ViewCompat.requestApplyInsets(child);
            }
        }
    }
}
