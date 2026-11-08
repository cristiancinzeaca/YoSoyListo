package es.yosoylisto.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.ComponentActivity;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.SystemBarStyle;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * Yo Soy Listo para Android: la web del juego dentro de un WebView propio.
 * - Las páginas de yosoylisto.es se quedan en la app; el resto de enlaces se abren fuera.
 * - El login con Google se hace en el navegador del móvil (Google no lo permite en un WebView)
 *   y vuelve con yosoylisto://login?code=… (ver /volver-app en la web).
 */
public class MainActivity extends ComponentActivity {
    private static final String HOST = "www.yosoylisto.es";
    private static final String BASE = "https://" + HOST;
    private static final String START = BASE + "/?utm_source=android";
    private static final int BG = 0xFF1B1035;

    private WebView web;
    private boolean ready = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        splash.setKeepOnScreenCondition(() -> !ready);
        new Handler(Looper.getMainLooper()).postDelayed(() -> ready = true, 4000);

        EdgeToEdge.enable(this, SystemBarStyle.dark(BG), SystemBarStyle.dark(BG));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Que la web no quede debajo de la barra de estado, de los botones ni del teclado.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " YoSoyListoApp/1");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isOurs(url)) return false;
                openOutside(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                ready = true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                ready = true;
                view.loadDataWithBaseURL(null, OFFLINE, "text/html", "utf-8", null);
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        if (savedInstanceState == null || web.copyBackForwardList().getSize() == 0) {
            web.loadUrl(urlFor(getIntent()));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getData() != null) web.loadUrl(urlFor(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Qué página abrir según cómo se ha abierto la app. */
    private static String urlFor(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null) return START;
        if ("yosoylisto".equals(data.getScheme())) {
            String code = data.getQueryParameter("code");
            if (code != null) return BASE + "/entrar#code=" + Uri.encode(code);
            String error = data.getQueryParameter("error");
            return BASE + "/entrar#error=" + Uri.encode(error == null ? "google" : error);
        }
        return isOurs(data) ? data.toString() : START;
    }

    private static boolean isOurs(Uri url) {
        String scheme = url.getScheme();
        String host = url.getHost();
        return ("https".equals(scheme) || "http".equals(scheme)) && host != null
                && (host.equals("yosoylisto.es") || host.endsWith(".yosoylisto.es"));
    }

    private void openOutside(Uri url) {
        try {
            Intent intent = "intent".equals(url.getScheme())
                    ? Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME)
                    : new Intent(Intent.ACTION_VIEW, url);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException | java.net.URISyntaxException ignored) {
            // No hay ninguna app que lo abra: no hacemos nada.
        }
    }

    private static final String OFFLINE = "<!doctype html><html lang='es'><head><meta charset='utf-8'>"
            + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;"
            + "background:#1b1035;color:#fff;font-family:sans-serif;text-align:center;padding:24px;box-sizing:border-box}"
            + "a{display:inline-block;margin-top:20px;background:#ffcb2b;color:#3b2300;padding:14px 28px;border-radius:14px;"
            + "font-weight:bold;text-decoration:none}</style></head><body><div><h1>Sin conexión</h1>"
            + "<p>Comprueba tu internet y vuelve a intentarlo.</p><a href='" + START + "'>Reintentar</a></div></body></html>";
}
