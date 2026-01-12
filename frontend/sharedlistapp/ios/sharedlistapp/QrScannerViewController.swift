import AVFoundation
import UIKit

final class QrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  var onResult: ((String?) -> Void)?
  var closeTitle: String = "Close"

  private var captureSession: AVCaptureSession?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var didReturn = false
  private let sessionQueue = DispatchQueue(label: "sharedlist.qr.session")

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    configureSession()
    configureOverlay()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.bounds
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    sessionQueue.async { [weak self] in
      self?.captureSession?.startRunning()
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    sessionQueue.async { [weak self] in
      self?.captureSession?.stopRunning()
    }
  }

  private func configureSession() {
    let session = AVCaptureSession()
    guard let videoDevice = AVCaptureDevice.default(for: .video) else {
      return
    }
    guard let videoInput = try? AVCaptureDeviceInput(device: videoDevice) else {
      return
    }
    if session.canAddInput(videoInput) {
      session.addInput(videoInput)
    }

    let metadataOutput = AVCaptureMetadataOutput()
    if session.canAddOutput(metadataOutput) {
      session.addOutput(metadataOutput)
      metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
      metadataOutput.metadataObjectTypes = [.qr]
    }

    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    preview.frame = view.layer.bounds
    view.layer.insertSublayer(preview, at: 0)

    previewLayer = preview
    captureSession = session
  }

  private func configureOverlay() {
    let closeButton = UIButton(type: .system)
    closeButton.setTitle(closeTitle, for: .normal)
    closeButton.setTitleColor(.white, for: .normal)
    closeButton.backgroundColor = UIColor(white: 0.1, alpha: 0.8)
    closeButton.layer.cornerRadius = 8
    closeButton.contentEdgeInsets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
    closeButton.addTarget(self, action: #selector(handleClose), for: .touchUpInside)

    closeButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(closeButton)

    NSLayoutConstraint.activate([
      closeButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      closeButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
    ])
  }

  @objc private func handleClose() {
    finish(with: nil)
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject else {
      return
    }
    guard obj.type == .qr else { return }
    let code = obj.stringValue
    finish(with: code)
  }

  private func finish(with code: String?) {
    guard !didReturn else { return }
    didReturn = true
    sessionQueue.async { [weak self] in
      self?.captureSession?.stopRunning()
    }
    dismiss(animated: true) { [onResult] in
      onResult?(code)
    }
  }
}
