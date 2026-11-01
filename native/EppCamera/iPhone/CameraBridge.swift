import SwiftUI
import WebKit
import WatchConnectivity

@MainActor
final class CameraBridge: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WCSessionDelegate {
    @Published var state = CameraState()
    @Published var status = "Log in en open Meer → Camera beta."
    @Published var showCamera = false
    @Published var cameraReady = false
    @Published var capturing = false
    @Published var lens = "Camera starten…"
    @Published var canRetry = false
    @Published var backupURL: URL?
    let camera = CameraController()
    private var gate = CaptureGate()
    private var active = false
    private var pending: (command: CaptureCommand, data: Data)?
    private var deadline: Task<Void, Never>?
    lazy var webView: WKWebView = makeWebView()
    private let hosts: Set<String> = ["epp-app.nl", "www.epp-app.nl"]
    private var watch: WCSession? { WCSession.isSupported() ? WCSession.default : nil }

    override init() {
        super.init()
        if FileManager.default.fileExists(atPath: backupPath.path) { backupURL = backupPath }
        if let watch { watch.delegate = self; watch.activate() }
    }
    private var backupPath: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("laatste-kaartfoto.jpg") }
    private func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "eppCamera")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self; view.uiDelegate = self
        view.load(URLRequest(url: URL(string: "https://epp-app.nl/")!))
        return view
    }
    func setActive(_ value: Bool) {
        active = value
        UIApplication.shared.isIdleTimerDisabled = value
        if value {
            camera.start { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let lens): self.lens = lens; self.cameraReady = self.active; if !self.active { self.camera.stop() }
                case .failure(let error): self.status = error.localizedDescription; self.cameraReady = false
                }
                self.publish()
            }
        } else { cameraReady = false; camera.stop() }
        publish()
    }
    private var effectiveState: CameraState {
        var current = state
        current.captureAllowed = current.captureAllowed && active && cameraReady && !capturing && pending == nil
        if !active { current.message = "Houd EPP Camera open en ontgrendeld op de iPhone." }
        else if capturing { current.message = "Foto maken en verwerken…" }
        else if pending != nil { current.message = "Geef de bewaarde foto opnieuw door op de iPhone." }
        else if !cameraReady { current.message = status }
        return current
    }
    private func publish() {
        guard let watch, watch.activationState == .activated else { return }
        try? watch.updateApplicationContext(effectiveState.dictionary)
        if watch.isReachable { watch.sendMessage(["type": "state", "state": effectiveState.dictionary], replyHandler: nil, errorHandler: { _ in }) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https", hosts.contains(message.frameInfo.securityOrigin.host),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "state", let next = CameraState(dictionary: body) {
            state = next; status = next.message; publish()
        } else if type == "capture", let context = body["contextId"] as? String {
            capture(CaptureCommand(contextID: context))
        }
    }
    func capture(_ command: CaptureCommand) {
        do { try gate.accept(command, state: effectiveState, active: active) }
        catch { status = "Foto niet gestart: open de juiste serie op de iPhone en probeer opnieuw."; publish(); return }
        capturing = true; publish()
        camera.capture { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error): self.capturing = false; self.status = error.localizedDescription; self.publish()
            case .success(let data):
                // Keep the original in memory until the web app acknowledges it.
                do {
                    try FileManager.default.createDirectory(at: self.backupPath.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try data.write(to: self.backupPath, options: [.atomic, .completeFileProtection])
                    self.backupURL = self.backupPath
                } catch { self.status = "Reservekopie kon niet worden bewaard; houd de app open tot de foto is verwerkt." }
                self.pending = (command, data); self.deliverPending()
            }
        }
    }
    func retry() { guard !capturing else { return }; capturing = true; deliverPending() }
    func discardPending() {
        guard !capturing else { return }
        pending = nil; canRetry = false; status = "Foto verwijderd. Maak zo nodig een nieuwe foto."; publish()
    }
    private func deliverPending() {
        guard let pending else { capturing = false; return }
        guard pending.command.contextID == state.contextID else {
            capturing = false; canRetry = false; status = "De schutter of stage is gewijzigd. Verwijder de bewaarde foto en maak een nieuwe."; publish(); return
        }
        let id = pending.command.id.uuidString
        deadline?.cancel()
        deadline = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 90_000_000_000)
            guard !Task.isCancelled, let self, self.pending?.command.id.uuidString == id else { return }
            self.capturing = false; self.canRetry = true; self.status = "Verwerking duurt lang. De foto is bewaard; controleer EPP voordat je opnieuw doorgeeft."; self.publish()
        }
        webView.callAsyncJavaScript("if (!window.EppCameraNative) throw new Error('Open Camera per serie in EPP.'); return await window.EppCameraNative.receivePhoto(photo);", arguments: ["photo": ["id": id, "contextId": pending.command.contextID, "mime": "image/jpeg", "base64": pending.data.base64EncodedString()]], in: nil, in: .page) { [weak self] result in
            guard let self, self.pending?.command.id.uuidString == id else { return }
            self.deadline?.cancel(); self.capturing = false
            switch result {
            case .failure:
                self.canRetry = true; self.status = "Foto nog niet overgenomen. Open Camera per serie en geef de bewaarde foto opnieuw door."
            case .success(let value):
                guard let response = value as? [String: Any], response["ok"] as? Bool == true else {
                    self.canRetry = true; self.status = "De serie is gewijzigd. Controleer de bewaarde foto op de iPhone."; self.publish(); return
                }
                self.pending = nil; self.canRetry = false
                self.status = response["message"] as? String ?? "Foto ontvangen."
                if response["phase"] as? String != "saved" { self.showCamera = false }
            }
            self.publish()
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "https", let host = url.host, hosts.contains(host) { decisionHandler(.allow) }
        else {
            decisionHandler(.cancel)
            if ["http", "https"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        }
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        state = CameraState(); publish()
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        status = "EPP kon niet laden. Controleer de internetverbinding."; state.captureAllowed = false; publish()
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        state = CameraState(); status = "EPP is opnieuw gestart. Stel de serie opnieuw in; bewaarde foto’s worden niet automatisch aan een andere serie gekoppeld."; publish(); webView.reload()
    }
    private func present(_ alert: UIAlertController) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              var controller = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
        while let next = controller.presentedViewController { controller = next }
        controller.present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "EPP", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }); present(alert)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "EPP", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Annuleren", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Doorgaan", style: .default) { _ in completionHandler(true) }); present(alert)
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { Task { @MainActor in self.publish() } }
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) { Task { @MainActor in self.publish() } }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        Task { @MainActor in
            if message["type"] as? String == "status" { replyHandler(["ok": true, "state": self.effectiveState.dictionary]); return }
            guard let command = CaptureCommand(dictionary: message) else { replyHandler(["ok": false, "message": "Ongeldig cameraverzoek."]); return }
            do {
                // Validate without consuming the command before acknowledging.
                var probe = self.gate; try probe.accept(command, state: self.effectiveState, active: self.active)
                replyHandler(["ok": true]); self.capture(command)
            } catch { replyHandler(["ok": false, "message": self.effectiveState.message]) }
        }
    }
}
