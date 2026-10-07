// Native rasterization of icon.svg's geometry; no external images or fonts.
import AppKit

let target = CommandLine.arguments[1]
let context = CGContext(data: nil, width: 1024, height: 1024,
                        bitsPerComponent: 8, bytesPerRow: 4096,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.scaleBy(x: 2, y: 2)
context.translateBy(x: 0, y: 512)
context.scaleBy(x: 1, y: -1)
context.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
context.fill(CGRect(x: 0, y: 0, width: 512, height: 512))

func card(x: CGFloat, y: CGFloat, red: CGFloat = 0, green: CGFloat = 0,
          blue: CGFloat = 0, separated: Bool = true) {
    let path = CGPath(roundedRect: CGRect(x: x, y: y, width: 180, height: 240),
                      cornerWidth: 18, cornerHeight: 18, transform: nil)
    if separated {
        context.addPath(path)
        context.setStrokeColor(red: 1, green: 1, blue: 1, alpha: 1)
        context.setLineWidth(20)
        context.strokePath()
    }
    context.addPath(path)
    context.setFillColor(red: red, green: green, blue: blue, alpha: 1)
    context.fillPath()
}

card(x: 226, y: 88, separated: false)
card(x: 166, y: 136)
card(x: 106, y: 184, red: 18 / 255.0, green: 10 / 255.0, blue: 143 / 255.0)

let image = NSBitmapImageRep(cgImage: context.makeImage()!)
try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: target))
