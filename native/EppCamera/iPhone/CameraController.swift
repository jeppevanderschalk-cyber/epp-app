import AVFoundation
import UIKit

final class CameraController: NSObject, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "nl.epp.camera.capture")
    private var configured = false
    private var captureID: Int64?
    private var completion: ((Result<Data, Error>) -> Void)?
    private(set) var lensLabel = "Camera"
    enum Failure: LocalizedError {
        case permission, unavailable, busy, failed, interrupted
        var errorDescription: String? {
            switch self {
            case .permission: return "Sta cameratoegang toe in Instellingen → EPP Camera."
            case .unavailable: return "De iPhone-camera is niet beschikbaar."
            case .busy: return "De vorige foto wordt nog verwerkt."
            case .failed: return "De foto kon niet worden gemaakt. Probeer opnieuw."
            case .interrupted: return "De camera is onderbroken. Houd de hulpapp open en ontgrendeld."
            }
        }
    }
    func start(completion: @escaping (Result<String, Error>) -> Void) {
        AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
            guard let self else { return }
            guard allowed else { DispatchQueue.main.async { completion(.failure(Failure.permission)) }; return }
            self.queue.async {
                do {
                    if !self.configured { try self.configure() }
                    if !self.session.isRunning { self.session.startRunning() }
                    DispatchQueue.main.async { completion(.success(self.lensLabel)) }
                } catch { DispatchQueue.main.async { completion(.failure(error)) } }
            }
        }
    }
    private func configure() throws {
        session.beginConfiguration(); defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        for input in session.inputs { session.removeInput(input) }
        for item in session.outputs { session.removeOutput(item) }
        // Select the physical telephoto camera: 5× on iPhone 16 Pro Max.
        let telephoto = AVCaptureDevice.default(.builtInTelephotoCamera, for: .video, position: .back)
        guard let device = telephoto ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { throw Failure.unavailable }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input), session.canAddOutput(output) else { throw Failure.unavailable }
        session.addInput(input); session.addOutput(output)
        if let dimensions = device.activeFormat.supportedMaxPhotoDimensions.max(by: { Int64($0.width) * Int64($0.height) < Int64($1.width) * Int64($1.height) }) { output.maxPhotoDimensions = dimensions }
        output.maxPhotoQualityPrioritization = .quality
        try device.lockForConfiguration(); defer { device.unlockForConfiguration() }
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
        if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }
        lensLabel = telephoto == nil ? "Groothoek — geen telelens beschikbaar" : "Telelens — 5× op iPhone 16 Pro Max"
        configured = true
    }
    func capture(completion: @escaping (Result<Data, Error>) -> Void) {
        queue.async {
            guard self.completion == nil else { DispatchQueue.main.async { completion(.failure(Failure.busy)) }; return }
            guard self.session.isRunning, !self.session.isInterrupted else { DispatchQueue.main.async { completion(.failure(Failure.interrupted)) }; return }
            self.completion = completion
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            settings.maxPhotoDimensions = self.output.maxPhotoDimensions
            settings.photoQualityPrioritization = .quality
            settings.flashMode = .off
            if let connection = self.output.connection(with: .video), connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            self.captureID = settings.uniqueID
            let id = settings.uniqueID
            self.output.capturePhoto(with: settings, delegate: self)
            self.queue.asyncAfter(deadline: .now() + 20) {
                guard self.captureID == id else { return }
                let callback = self.completion; self.completion = nil; self.captureID = nil
                DispatchQueue.main.async { callback?(.failure(Failure.failed)) }
            }
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        queue.async {
            guard self.captureID == photo.resolvedSettings.uniqueID else { return }
            let result: Result<Data, Error>
            if let error { result = .failure(error) }
            else if let data = photo.fileDataRepresentation(), data.count <= 30_000_000 { result = .success(data) }
            else { result = .failure(Failure.failed) }
            let callback = self.completion; self.completion = nil; self.captureID = nil
            DispatchQueue.main.async { callback?(result) }
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        guard let error else { return }
        queue.async {
            guard self.captureID == resolvedSettings.uniqueID else { return }
            let callback = self.completion; self.completion = nil; self.captureID = nil
            DispatchQueue.main.async { callback?(.failure(error)) }
        }
    }
    func stop() { queue.async { if self.session.isRunning { self.session.stopRunning() } } }
}
