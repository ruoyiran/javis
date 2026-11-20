import CoreGraphics
import ImageIO
import XCTest
@testable import JavisComputerUseCore

final class ScreenshotEncodingTests: XCTestCase {
    func testJPEGRespectsScaleAndMaximumEdge() throws {
        let context = try XCTUnwrap(CGContext(data: nil, width: 200, height: 100, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
        let image = try XCTUnwrap(context.makeImage())
        let encoded = try XCTUnwrap(ScreenshotEncoding.encode(image, windowWidth: 100, options: ScreenshotOptions(format: .jpeg, maxScale: 1, maxEdge: 80)))
        XCTAssertEqual(encoded.width, 80)
        XCTAssertEqual(encoded.height, 40)
        XCTAssertEqual(encoded.format, .jpeg)
        XCTAssertEqual(Array(encoded.data.prefix(2)), [255, 216])
        let source = try XCTUnwrap(CGImageSourceCreateWithData(encoded.data as CFData, nil))
        XCTAssertNotNil(CGImageSourceCreateImageAtIndex(source, 0, nil))
    }
}
