// Generate display icons and unmasked platform masters from icon-design.json.
import AppKit

let target = CommandLine.arguments[1]
let mode = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "dark"
precondition(mode == "light" || mode == "dark", "Expected light or dark icon mode.")
let rendering = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "masked"
precondition(rendering == "masked" || rendering == "unmasked", "Expected masked or unmasked rendering.")
struct IconDesign: Decodable {
    struct Palette: Decodable { let background: String; let foreground: String; let border: String }
    let canvasSize: Double
    let blue: String
    let cardWidth: Double
    let cardHeight: Double
    let cornerRadius: Double
    let offsetX: Double
    let offsetY: Double
    let gap: Double
    let appearances: [String: Palette]
}
let sourceDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let design = try JSONDecoder().decode(IconDesign.self, from: Data(contentsOf: sourceDirectory.appendingPathComponent("icon-design.json")))
let blueRGB = UInt32(design.blue.dropFirst(), radix: 16)!
func rgb(_ hex: String) -> (CGFloat, CGFloat, CGFloat) {
    let value = UInt32(hex.dropFirst(), radix: 16)!
    return (CGFloat((value >> 16) & 255) / 255, CGFloat((value >> 8) & 255) / 255, CGFloat(value & 255) / 255)
}
let palette = design.appearances[mode]!
let background = rgb(palette.background)
let foreground = rgb(palette.foreground)
let border = rgb(palette.border)
let context = CGContext(data: nil, width: 1024, height: 1024,
                        bitsPerComponent: 8, bytesPerRow: 4096,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.scaleBy(x: 2, y: 2)
context.translateBy(x: 0, y: 512)
context.scaleBy(x: 1, y: -1)
struct IconMask: Decodable { let points: [[Double]] }
let maskURL = sourceDirectory.appendingPathComponent("apple-icon-mask.json")
let mask = try JSONDecoder().decode(IconMask.self, from: Data(contentsOf: maskURL))
let frame = CGMutablePath()
if rendering == "unmasked" {
    frame.addRect(CGRect(x: 0, y: 0, width: design.canvasSize, height: design.canvasSize))
} else {
    for (index, point) in mask.points.enumerated() {
        let position = CGPoint(x: 2 + point[0] * 508 / 512, y: 2 + point[1] * 508 / 512)
        if index == 0 { frame.move(to: position) } else { frame.addLine(to: position) }
    }
    frame.closeSubpath()
}
context.addPath(frame)
context.setFillColor(red: background.0, green: background.1, blue: background.2, alpha: 1)
context.fillPath()

func card(x: CGFloat, y: CGFloat, blue: Bool = false, separated: Bool = true) {
    let path = CGPath(roundedRect: CGRect(x: x, y: y, width: design.cardWidth, height: design.cardHeight),
                      cornerWidth: design.cornerRadius, cornerHeight: design.cornerRadius, transform: nil)
    if separated {
        context.addPath(path)
        context.setStrokeColor(red: background.0, green: background.1, blue: background.2, alpha: 1)
        context.setLineWidth(design.gap * 2)
        context.strokePath()
    }
    context.addPath(path)
    if blue {
        context.setFillColor(red: CGFloat((blueRGB >> 16) & 255) / 255, green: CGFloat((blueRGB >> 8) & 255) / 255, blue: CGFloat(blueRGB & 255) / 255, alpha: 1)
    } else {
        context.setFillColor(red: foreground.0, green: foreground.1, blue: foreground.2, alpha: 1)
    }
    context.fillPath()
}

let centerX = (design.canvasSize - design.cardWidth) / 2
let centerY = (design.canvasSize - design.cardHeight) / 2
card(x: centerX + design.offsetX, y: centerY - design.offsetY, separated: false)
card(x: centerX, y: centerY, blue: true)
card(x: centerX - design.offsetX, y: centerY + design.offsetY)

if rendering == "masked" {
context.addPath(frame)
context.setStrokeColor(red: border.0, green: border.1, blue: border.2, alpha: 1)
context.setLineWidth(3)
context.strokePath()
}

let image = NSBitmapImageRep(cgImage: context.makeImage()!)
try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: target))
