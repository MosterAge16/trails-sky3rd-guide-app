package app.trailsguide;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** A full-screen WebView showing the offline reader bundled in assets/www. */
public final class MainActivity extends Activity {
    private static final String TAG = "TrailsGuide";
    private static final String START = "file:///android_asset/www/index.html";
    private static final String OWN_PATH = "/android_asset/www/";

    private WebView web;
    private boolean pageCanGoBack;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        // Lay the page out behind the system bars and pad by their insets, so the layout is the
        // same whether the Android version draws apps edge to edge or not.
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
                return insets;
            }
        });
        web = createWebView();
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        applySystemBars();
        web.loadUrl(START);
    }

    private WebView createWebView() {
        WebView view = new WebView(this);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // reading position and ticks are kept in localStorage
        settings.setTextZoom(100);           // the page has its own text size setting
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(false);  // file:///android_asset keeps working
        view.addJavascriptInterface(new PageBridge(), "AndroidBridge");
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                return !isOwnPage(request.getUrl());
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.println(consolePriority(message.messageLevel()), TAG,
                        message.message() + " (" + message.lineNumber() + ")");
                return true;
            }
        });
        return view;
    }

    private static int consolePriority(ConsoleMessage.MessageLevel level) {
        switch (level) {
            case ERROR: return Log.ERROR;
            case WARNING: return Log.WARN;
            default: return Log.INFO;
        }
    }

    /** Lets the bundled page load; links to the source site go to a browser instead. */
    private boolean isOwnPage(Uri uri) {
        if ("file".equals(uri.getScheme()) && uri.getPath() != null && uri.getPath().startsWith(OWN_PATH)) {
            return true;
        }
        String scheme = uri.getScheme();
        if ("http".equals(scheme) || "https".equals(scheme)) {
            openInBrowser(uri);
        }
        return false;
    }

    private void openInBrowser(Uri uri) {
        try {
            startActivity(Intent.createChooser(new Intent(Intent.ACTION_VIEW, uri), getString(R.string.open_with)));
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "no app can open " + uri);
        }
    }

    /** Things the page asks the app to do, since it cannot do them itself. */
    private final class PageBridge {
        @JavascriptInterface
        public void setCanBack(boolean value) {
            pageCanGoBack = value;
        }

        @JavascriptInterface
        public void openUrl(String url) {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if ("http".equals(scheme) || "https".equals(scheme)) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        openInBrowser(uri);
                    }
                });
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (!pageCanGoBack) {
            super.onBackPressed();
            return;
        }
        // The page closes its top-most overlay or returns to the reading tab;
        // "false" means it had nothing left to close.
        web.evaluateJavascript("window.TrailsBack ? window.TrailsBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String result) {
                if (!"true".equals(result)) {
                    MainActivity.super.onBackPressed();
                }
            }
        });
    }

    private void applySystemBars() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        applySystemBars();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
