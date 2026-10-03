// Native rasterization of icon.svg's geometry; no external images or fonts.
import AppKit

let target = CommandLine.arguments[1]
let image = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
                            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                            isPlanar: false, colorSpaceName: .deviceRGB,
                            bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: image)
NSColor(calibratedRed: 247 / 255.0, green: 248 / 255.0, blue: 243 / 255.0, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 60, y: 60, width: 904, height: 904), xRadius: 208, yRadius: 208).fill()
NSColor(calibratedRed: 80 / 255.0, green: 116 / 255.0, blue: 94 / 255.0, alpha: 1).setStroke()
for index in 0..<4 {
    let angle = Double(index) * Double.pi / 4
    let dx = 240 * cos(angle), dy = 240 * sin(angle)
    let stroke = NSBezierPath()
    stroke.lineWidth = 84
    stroke.lineCapStyle = .round
    stroke.move(to: NSPoint(x: 512 - dx, y: 512 - dy))
    stroke.line(to: NSPoint(x: 512 + dx, y: 512 + dy))
    stroke.stroke()
}
NSGraphicsContext.restoreGraphicsState()
try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: target))
