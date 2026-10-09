import ExpoModulesCore
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
  }
}

struct AppleLlmUnavailable: Error, CustomStringConvertible {
  var description: String { "Apple's on-device model requires iOS 26 with Apple Intelligence" }
}
