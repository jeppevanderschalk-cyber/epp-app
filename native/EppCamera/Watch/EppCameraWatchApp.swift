import SwiftUI
import WatchConnectivity

@MainActor
final class WatchCamera: NSObject, ObservableObject, WCSessionDelegate {
    @Published var state = CameraState()
    @Published var connected = false
    @Published var sending = false
    @Published var notice = "Open EPP Camera op je iPhone."
    private let session = WCSession.default
    private var timeout: Task<Void, Never>?
    override init() { super.init(); session.delegate = self; session.activate() }
    func refresh() {
        connected = session.isReachable
        guard connected else { notice = "Open de hulpapp op je ontgrendelde iPhone."; return }
        session.sendMessage(["type": "status"], replyHandler: { response in
            Task { @MainActor in if let value = response["state"] as? [String: Any] { self.update(value) } }
        }, errorHandler: { error in Task { @MainActor in self.notice = "Geen verbinding. Probeer opnieuw." } })
    }
    private func update(_ value: [String: Any]) {
        guard let next = CameraState(dictionary: value) else { return }
        state = next; notice = next.message; connected = session.isReachable
        if next.captureAllowed { sending = false; timeout?.cancel() }
    }
    func takePhoto() {
        guard !sending, state.captureAllowed, session.isReachable else { refresh(); return }
        sending = true; notice = "Foto wordt aangevraagd…"
        let command = CaptureCommand(contextID: state.contextID)
        // Never retry automatically: two requests could represent two different series.
        session.sendMessage(command.dictionary, replyHandler: { response in
            Task { @MainActor in
                if response["ok"] as? Bool != true { self.sending = false; self.notice = response["message"] as? String ?? "Controleer de iPhone." }
            }
        }, errorHandler: { _ in Task { @MainActor in self.sending = false; self.notice = "Verzoek niet bevestigd. Controleer de iPhone voordat je opnieuw drukt." } })
        timeout?.cancel()
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 90_000_000_000)
            guard !Task.isCancelled, let self else { return }
            self.sending = false; self.notice = "Controleer de verwerking op de iPhone."; self.refresh()
        }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { Task { @MainActor in self.refresh() } }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) { Task { @MainActor in self.refresh() } }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) { Task { @MainActor in self.update(applicationContext) } }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let state = message["state"] as? [String: Any] { Task { @MainActor in self.update(state) } }
    }
}
@main
struct EppCameraWatchApp: App {
    @StateObject private var camera = WatchCamera()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            ScrollView {
                VStack(spacing: 10) {
                    Text("EPP Camera").font(.headline)
                    Text("Totaal: \(camera.state.score)").font(.title3)
                    if camera.state.pendingScore > 0 { Text("Voorlopig: +\(camera.state.pendingScore)").foregroundStyle(.orange) }
                    Button { camera.takePhoto() } label: { Label("Maak foto", systemImage: "camera.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent).disabled(camera.sending || !camera.connected || !camera.state.captureAllowed)
                    Text(camera.notice).font(.footnote).multilineTextAlignment(.center)
                    Button("Verbinding verversen") { camera.refresh() }.font(.footnote)
                }.padding(.horizontal, 4)
            }
            .onAppear { camera.refresh() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { camera.refresh() } }
        }
    }
}
