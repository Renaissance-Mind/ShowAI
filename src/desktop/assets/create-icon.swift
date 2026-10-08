// Native rasterization of icon.svg and icon-light.svg; no external images or fonts.
import AppKit

let target = CommandLine.arguments[1]
let mode = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "dark"
precondition(mode == "light" || mode == "dark", "Expected light or dark icon mode.")
let dark = mode == "dark"
let background: CGFloat = dark ? 0 : 1
let foreground: CGFloat = dark ? 1 : 0
let context = CGContext(data: nil, width: 1024, height: 1024,
                        bitsPerComponent: 8, bytesPerRow: 4096,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.scaleBy(x: 2, y: 2)
context.translateBy(x: 0, y: 512)
context.scaleBy(x: 1, y: -1)
struct IconMask: Decodable { let points: [[Double]] }
let maskURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("apple-icon-mask.json")
let mask = try JSONDecoder().decode(IconMask.self, from: Data(contentsOf: maskURL))
let frame = CGMutablePath()
for (index, point) in mask.points.enumerated() {
    let position = CGPoint(x: 2 + point[0] * 508 / 512, y: 2 + point[1] * 508 / 512)
    if index == 0 { frame.move(to: position) } else { frame.addLine(to: position) }
}
frame.closeSubpath()
context.addPath(frame)
context.setFillColor(red: background, green: background, blue: background, alpha: 1)
context.fillPath()

func card(x: CGFloat, y: CGFloat, blue: Bool = false, separated: Bool = true) {
    let path = CGPath(roundedRect: CGRect(x: x, y: y, width: 180, height: 240),
                      cornerWidth: 37, cornerHeight: 37, transform: nil)
    if separated {
        context.addPath(path)
        context.setStrokeColor(red: background, green: background, blue: background, alpha: 1)
        context.setLineWidth(32)
        context.strokePath()
    }
    context.addPath(path)
    if blue {
        context.setFillColor(red: 6 / 255.0, green: 165 / 255.0, blue: 250 / 255.0, alpha: 1)
    } else {
        context.setFillColor(red: foreground, green: foreground, blue: foreground, alpha: 1)
    }
    context.fillPath()
}

card(x: 241, y: 76, separated: false)
card(x: 166, y: 136, blue: true)
card(x: 91, y: 196)

context.addPath(frame)
if dark {
    context.setStrokeColor(red: 63 / 255.0, green: 63 / 255.0, blue: 70 / 255.0, alpha: 1)
} else {
    context.setStrokeColor(red: 211 / 255.0, green: 214 / 255.0, blue: 222 / 255.0, alpha: 1)
}
context.setLineWidth(3)
context.strokePath()

let image = NSBitmapImageRep(cgImage: context.makeImage()!)
try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: target))
