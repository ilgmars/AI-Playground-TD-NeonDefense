package com.neondefense.game;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private WebViewAssetLoader assetLoader;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        NeonDefenseApp.installCrashHandler(this);

        String prevCrash = NeonDefenseApp.readCrashAndClear(this);
        if (prevCrash != null) {
            showCrashReport(prevCrash);
            return;
        }

        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            setupWebView();
            enableImmersiveMode();
        } catch (Throwable t) {
            NeonDefenseApp.writeCrash(this, Thread.currentThread(), t);
            showCrashReport("Crash during MainActivity.onCreate\n\n"
                    + android.util.Log.getStackTraceString(t));
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .setHttpAllowed(false)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Performance: hint the GPU compositor to keep the WebView layer on the GPU.
        // This avoids the software-rendering fallback that makes canvas animation lag.
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        // Keep the CPU from throttling during active gameplay.
        webView.setKeepScreenOn(true);

        webView.setBackgroundColor(0xFF0A0E27);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("NeonDefense",
                        "[" + m.messageLevel() + "] " + m.message()
                                + " @ " + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                String scheme = request.getUrl().getScheme();
                if ("appassets.androidplatform.net".equals(host)) {
                    return assetLoader.shouldInterceptRequest(request.getUrl());
                }
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return new WebResourceResponse("text/plain", "utf-8",
                            new java.io.ByteArrayInputStream(new byte[0]));
                }
                return null;
            }

            @Override
            public boolean onRenderProcessGone(WebView view,
                                               android.webkit.RenderProcessGoneDetail detail) {
                String msg = "WebView render process gone. didCrash="
                        + (detail != null && detail.didCrash());
                NeonDefenseApp.writeCrash(MainActivity.this,
                        Thread.currentThread(), new RuntimeException(msg));
                recreate();
                return true;
            }
        });

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    private void showCrashReport(String text) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0A0E27"));
        root.setPadding(24, 48, 24, 24);

        TextView title = new TextView(this);
        title.setText("Neon Defense — last-run crash");
        title.setTextColor(Color.parseColor("#F87171"));
        title.setTextSize(18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setPadding(0, 0, 0, 12);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Copy/screenshot and send this to fix the crash.");
        hint.setTextColor(Color.parseColor("#94A3B8"));
        hint.setTextSize(12);
        hint.setPadding(0, 0, 0, 12);
        root.addView(hint);

        ScrollView scroll = new ScrollView(this);
        TextView body = new TextView(this);
        body.setText(text);
        body.setTextIsSelectable(true);
        body.setTextColor(Color.parseColor("#F1F5F9"));
        body.setTypeface(Typeface.MONOSPACE);
        body.setTextSize(11);
        body.setPadding(12, 12, 12, 12);
        body.setBackgroundColor(Color.parseColor("#1E293B"));
        scroll.addView(body);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(scroll, slp);

        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                recreate();
            }
        });
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        blp.topMargin = 16;
        root.addView(retry, blp);

        root.setGravity(Gravity.TOP);
        setContentView(root);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enableImmersiveMode();
    }

    private void enableImmersiveMode() {
        Window window = getWindow();
        if (window == null) return;
        View decor = window.getDecorView();
        if (decor == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController ctl = window.getInsetsController();
            if (ctl != null) {
                ctl.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                ctl.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }
}
