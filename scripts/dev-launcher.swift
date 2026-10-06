import AppKit
import Foundation

final class DevelopmentLauncher: NSObject, NSApplicationDelegate {
    private var task: Process?
    private var window: NSWindow?
    private var pendingURL: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        pendingURL = CommandLine.arguments.first(where: { $0.hasPrefix("showai://") })
        start()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        pendingURL = urls.first?.absoluteString
        if task == nil { start() }
    }

    private func start() {
        do {
            let configURL = Bundle.main.resourceURL!.appendingPathComponent("launch.json")
            let config = try JSONSerialization.jsonObject(with: Data(contentsOf: configURL)) as! [String: Any]
            let source = config["sourceRoot"] as! String
            let process = Process()
            process.executableURL = URL(fileURLWithPath: config["nodeExecutable"] as! String)
            process.currentDirectoryURL = URL(fileURLWithPath: source)
            process.arguments = [source + "/scripts/dev-open.mjs", "--home", config["home"] as! String, "--port", String(config["port"] as! Int)]
            if let url = pendingURL { process.arguments! += ["--url", url]; pendingURL = nil }
            var environment = ProcessInfo.processInfo.environment
            environment.removeValue(forKey: "ELECTRON_RUN_AS_NODE")
            process.environment = environment
            let output = Pipe(), errors = Pipe()
            process.standardOutput = output
            process.standardError = errors
            process.terminationHandler = { [weak self] completed in
                let data = output.fileHandleForReading.readDataToEndOfFile()
                let error = errors.fileHandleForReading.readDataToEndOfFile()
                DispatchQueue.main.async {
                    self?.finished(completed.terminationStatus, data, error)
                }
            }
            task = process
            try process.run()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                if self?.task?.isRunning == true { self?.showProgress() }
            }
        } catch { showError(error.localizedDescription) }
    }

    private func showProgress() {
        if window != nil { return }
        let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 410, height: 150), styleMask: [.titled], backing: .buffered, defer: false)
        panel.title = "ShowAI"
        panel.center()
        let title = NSTextField(labelWithString: "正在打开实时测试版")
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        title.frame = NSRect(x: 25, y: 94, width: 360, height: 24)
        let description = NSTextField(wrappingLabelWithString: "正在连接当前代码。保存修改后，界面会自动更新。")
        description.frame = NSRect(x: 25, y: 43, width: 350, height: 40)
        description.textColor = .secondaryLabelColor
        let progress = NSProgressIndicator(frame: NSRect(x: 25, y: 22, width: 360, height: 8))
        progress.style = .bar
        progress.isIndeterminate = true
        progress.startAnimation(nil)
        panel.contentView?.addSubview(title)
        panel.contentView?.addSubview(description)
        panel.contentView?.addSubview(progress)
        window = panel
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func finished(_ code: Int32, _ data: Data, _ errors: Data) {
        task = nil
        guard code == 0 else { showError(String(data: errors, encoding: .utf8) ?? "启动失败"); return }
        if pendingURL != nil { start(); return }
        do {
            let result = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            if let pid = result["backendPid"] as? Int {
                NSRunningApplication(processIdentifier: pid_t(pid))?.activate(options: [.activateAllWindows])
            }
            window?.close()
            NSApp.terminate(nil)
        } catch { showError(error.localizedDescription) }
    }

    private func showError(_ detail: String) {
        window?.close()
        let alert = NSAlert()
        alert.messageText = "ShowAI 无法打开"
        alert.informativeText = detail
        alert.addButton(withTitle: "确定")
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = DevelopmentLauncher()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
