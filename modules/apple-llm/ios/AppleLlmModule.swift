import ExpoModulesCore
import UIKit
import Vision
#if canImport(FoundationModels)
import FoundationModels
#endif

// Apple's on-device Foundation Model as a plain text backend for LlmDecisionEngine (src/engine).
// - Greedy sampling: the same prompt gives the same answer, so option-order tests are meaningful.
// - `permissive`: the default guardrails refuse most political/misinformation text ("May contain sensitive content");
//   permissiveContentTransformations is Apple's mode for transforming user-provided content, which classification is.
// - One fresh session per call: decisions must not leak context into each other.
public class AppleLlmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleLlm")

    Function("availability") { () -> [String: Any] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
          return ["available": true, "reason": "available"]
        case .unavailable(let reason):
          return ["available": false, "reason": String(describing: reason)]
        }
      }
      #endif
      return ["available": false, "reason": "requires iOS 26 with Apple Intelligence"]
    }

    AsyncFunction("respond") { (instructions: String, prompt: String, permissive: Bool) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        let model = permissive
          ? SystemLanguageModel(guardrails: .permissiveContentTransformations)
          : SystemLanguageModel.default
        let session = LanguageModelSession(model: model, instructions: instructions)
        let response = try await session.respond(to: prompt, options: GenerationOptions(sampling: .greedy))
        return response.content
      }
      #endif
      throw AppleLlmUnavailable()
    }

    // On-device OCR (Apple Vision) for the Scan screen: text lines top to bottom, each with its normalized top edge and
    // height so JS can group lines into paragraphs. Language correction is off: it "fixes" Tagalog words into English.
    AsyncFunction("recognizeText") { (uri: String) async throws -> [[String: Any]] in
      let url = uri.hasPrefix("file://") ? URL(string: uri) : URL(fileURLWithPath: uri)
      guard let url = url, let data = try? Data(contentsOf: url), let image = UIImage(data: data)?.cgImage else {
        throw OcrImageUnreadable()
      }
      return try await Task.detached(priority: .userInitiated) { () throws -> [[String: Any]] in
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return (request.results ?? []).compactMap { obs -> [String: Any]? in
          guard let top = obs.topCandidates(1).first else { return nil }
          let box = obs.boundingBox
          return ["text": top.string, "top": 1 - box.maxY, "height": box.height, "left": box.minX]
        }
      }.value
    }
  }
}

struct OcrImageUnreadable: Error, CustomStringConvertible {
  var description: String { "Could not read the screenshot" }
}

struct AppleLlmUnavailable: Error, CustomStringConvertible {
  var description: String { "Apple's on-device model requires iOS 26 with Apple Intelligence" }
}
