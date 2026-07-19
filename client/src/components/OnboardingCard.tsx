const STORAGE_KEY = 'llmrpg.onboarding.v1';

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return true;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // ignore quota / private mode
  }
}

export interface OnboardingCardProps {
  onStart: () => void;
}

export function OnboardingCard({ onStart }: OnboardingCardProps) {
  return (
    <div className="modal-backdrop onboarding-backdrop" role="presentation">
      <div
        className="modal-dialog onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Milltown"
      >
        <header className="modal-header">
          <h2>🏰 Welcome to Milltown</h2>
        </header>
        <ul className="onboarding-list">
          <li>
            <span aria-hidden>🚶</span>
            <span>Click or arrow-keys to walk</span>
          </li>
          <li>
            <span aria-hidden>💬</span>
            <span>Type anytime — folk nearby will answer</span>
          </li>
          <li>
            <span aria-hidden>📖</span>
            <span>Your journal remembers everything</span>
          </li>
        </ul>
        <button
          type="button"
          className="btn-primary onboarding-start"
          onClick={() => {
            markOnboardingDone();
            onStart();
          }}
        >
          Start
        </button>
      </div>
    </div>
  );
}
