import Foundation
import Darwin

guard CommandLine.arguments.count == 3 else {
    throw NSError(domain: "ShowAIInstall", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Expected staging and installed App paths."
    ])
}
let staging = CommandLine.arguments[1]
let installed = CommandLine.arguments[2]
let files = FileManager.default

if files.fileExists(atPath: installed) {
    let result = staging.withCString { source in
        installed.withCString { destination in
            renamex_np(source, destination, UInt32(RENAME_SWAP))
        }
    }
    if result != 0 {
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: [
            NSLocalizedDescriptionKey: "Cannot atomically replace the stable App."
        ])
    }
} else {
    try files.moveItem(atPath: staging, toPath: installed)
}
