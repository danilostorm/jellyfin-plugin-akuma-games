package org.jellyfin.androidtv.ui.games

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.jellyfin.androidtv.auth.repository.ServerRepository
import org.jellyfin.androidtv.auth.repository.SessionRepository
import org.koin.android.ext.android.inject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class AkumaGamesActivity : AppCompatActivity() {
	private val sessionRepository by inject<SessionRepository>()
	private val serverRepository by inject<ServerRepository>()

	private lateinit var webView: WebView

	@Volatile
	private var gameOpen = false

	@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)

		window.decorView.systemUiVisibility = (
			View.SYSTEM_UI_FLAG_FULLSCREEN
				or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
				or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
		)

		webView = WebView(this).apply {
			setBackgroundColor(Color.BLACK)
			isFocusable = true
			isFocusableInTouchMode = true
			setLayerType(View.LAYER_TYPE_HARDWARE, null)

			settings.javaScriptEnabled = true
			settings.domStorageEnabled = true
			settings.databaseEnabled = true
			settings.mediaPlaybackRequiresUserGesture = false
			settings.allowFileAccess = true
			settings.allowContentAccess = true
			settings.allowFileAccessFromFileURLs = true
			settings.allowUniversalAccessFromFileURLs = true
			settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
			settings.userAgentString = settings.userAgentString + " AkumaGamesTV/0.1.0"

			webChromeClient = WebChromeClient()
			webViewClient = object : WebViewClient() {
				override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false
			}

			addJavascriptInterface(AndroidBridge(), "AkumaGamesAndroid")
		}

		CookieManager.getInstance().apply {
			setAcceptCookie(true)
			setAcceptThirdPartyCookies(webView, true)
		}

		setContentView(
			webView,
			ViewGroup.LayoutParams(
				ViewGroup.LayoutParams.MATCH_PARENT,
				ViewGroup.LayoutParams.MATCH_PARENT,
			)
		)

		onBackPressedDispatcher.addCallback(this) {
			if (gameOpen) {
				webView.evaluateJavascript("window.AkumaTv && window.AkumaTv.closeGame();", null)
			} else {
				finishAfterTransition()
			}
		}

		webView.loadUrl("file:///android_asset/akuma_games_tv.html")
	}

	override fun onResume() {
		super.onResume()
		webView.onResume()
		webView.requestFocus()
	}

	override fun onPause() {
		webView.onPause()
		super.onPause()
	}

	override fun onDestroy() {
		webView.removeJavascriptInterface("AkumaGamesAndroid")
		webView.loadUrl("about:blank")
		webView.stopLoading()
		webView.clearHistory()
		webView.removeAllViews()
		webView.destroy()
		super.onDestroy()
	}

	private inner class AndroidBridge {
		@JavascriptInterface
		fun requestCatalog(refresh: Boolean) {
			lifecycleScope.launch {
				try {
					val suffix = if (refresh) "?refresh=true" else ""
					val payload = authenticatedGet("/AkumaGames/Catalog$suffix")
					deliverJson("receiveCatalog", payload)
				} catch (error: Throwable) {
					deliverError(error)
				}
			}
		}

		@JavascriptInterface
		fun requestLaunch(gameId: Int) {
			if (gameId <= 0) return

			lifecycleScope.launch {
				try {
					val payload = authenticatedGet("/AkumaGames/Games/$gameId/Launch")
					deliverJson("receiveLaunch", payload)
				} catch (error: Throwable) {
					deliverError(error)
				}
			}
		}

		@JavascriptInterface
		fun setGameOpen(open: Boolean) {
			gameOpen = open
		}

		@JavascriptInterface
		fun exit() {
			runOnUiThread { finishAfterTransition() }
		}
	}

	private suspend fun authenticatedGet(path: String): String = withContext(Dispatchers.IO) {
		val session = sessionRepository.currentSession.value
			?: throw IOException("Nenhuma sessão Jellyfin ativa.")
		val server = serverRepository.currentServer.value
			?: serverRepository.getServer(session.serverId)
			?: throw IOException("Servidor Jellyfin não encontrado.")

		val endpoint = server.address.trimEnd('/') + path
		val connection = URL(endpoint).openConnection() as HttpURLConnection
		try {
			connection.requestMethod = "GET"
			connection.connectTimeout = 20_000
			connection.readTimeout = 45_000
			connection.useCaches = false
			connection.setRequestProperty("Accept", "application/json")
			connection.setRequestProperty("X-Emby-Token", session.accessToken)
			connection.setRequestProperty(
				"Authorization",
				"MediaBrowser Token=\"${session.accessToken}\""
			)

			val status = connection.responseCode
			val stream = if (status in 200..299) connection.inputStream else connection.errorStream
			val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()

			if (status !in 200..299) {
				throw IOException("Akuma Games respondeu HTTP $status${if (body.isBlank()) "." else ": $body"}")
			}

			body
		} finally {
			connection.disconnect()
		}
	}

	private fun deliverJson(functionName: String, json: String) {
		val encoded = Base64.encodeToString(json.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
		runOnUiThread {
			if (!isFinishing && !isDestroyed) {
				webView.evaluateJavascript(
					"window.AkumaTv && window.AkumaTv.$functionName(decodeURIComponent(escape(atob('$encoded'))));",
					null,
				)
			}
		}
	}

	private fun deliverError(error: Throwable) {
		val message = error.message ?: error.javaClass.simpleName
		val encoded = Base64.encodeToString(message.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
		runOnUiThread {
			if (!isFinishing && !isDestroyed) {
				webView.evaluateJavascript(
					"window.AkumaTv && window.AkumaTv.receiveError(decodeURIComponent(escape(atob('$encoded'))));",
					null,
				)
			}
		}
	}
}
