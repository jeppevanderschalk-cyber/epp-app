import SwiftUI
import AVFoundation
import WebKit

@main
struct EppCameraApp: App {
    @StateObject private var bridge = CameraBridge()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 0) {
                HStack {
                    Text("EPP Camera").font(.headline)
                    Spacer()
                    Button(bridge.showCamera ? "Naar EPP" : "Camera bekijken") { bridge.showCamera.toggle() }
                }.padding(12)
                ZStack {
                    EppWebView(webView: bridge.webView)
                    if bridge.showCamera {
                        VStack {
                            Text(bridge.lens).font(.caption).padding(8)
                            CameraPreview(session: bridge.camera.session)
                            Text("Plaats de hele kaart recht in beeld. Laat lens, oriëntatie en statief tijdens de meting ongewijzigd.").font(.caption).padding()
                            Button("Maak foto") { bridge.capture(CaptureCommand(contextID: bridge.state.contextID)) }
                                .buttonStyle(.borderedProminent).disabled(!bridge.state.captureAllowed || !bridge.cameraReady || bridge.capturing)
                        }.background(Color.black).foregroundStyle(.white)
                    }
                }
                VStack(spacing: 8) {
                    Text(bridge.capturing ? "Foto maken en verwerken…" : bridge.status).font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                    if let url = bridge.backupURL { ShareLink("Laatste originele foto delen", item: url).font(.caption) }
                    if bridge.canRetry { Button("Bewaarde foto opnieuw doorgeven") { bridge.retry() }.disabled(bridge.capturing) }
                    if bridge.canRetry || bridge.status.contains("Verwijder de bewaarde foto") {
                        Button("Bewaarde foto verwijderen", role: .destructive) { bridge.discardPending() }.disabled(bridge.capturing)
                    }
                }.padding(10).background(.thinMaterial)
            }
            .onAppear { bridge.setActive(true) }
            .onChange(of: scenePhase) { _, phase in bridge.setActive(phase == .active) }
        }
    }
}
struct EppWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
private final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> UIView {
        let view = PreviewView(); view.previewLayer.session = session; view.previewLayer.videoGravity = .resizeAspect
        if let connection = view.previewLayer.connection, connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
        return view
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
