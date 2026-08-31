export type TrustPolicyConfig = {
  threshold: number;
};

export class TrustPolicyService {
  constructor(private readonly config: TrustPolicyConfig) {}

  shouldApprove(confidence: number): boolean {
    return confidence >= this.config.threshold;
  }
}
