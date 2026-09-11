export interface StepConfig {
  key: string;
  label: string;
}

interface StepperProps {
  steps: StepConfig[];
  currentIndex: number;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4 10.5 8 14.5 16 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Stepper({ steps, currentIndex }: StepperProps) {
  return (
    <ol className="flex w-full items-start" aria-label="Postęp rejestracji">
      {steps.map((step, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <li
            key={step.key}
            className={`flex items-start ${i === steps.length - 1 ? 'flex-none' : 'flex-1'}`}
          >
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={[
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all duration-300',
                  isComplete
                    ? 'bg-brand-600 text-white shadow-soft'
                    : isCurrent
                      ? 'bg-white text-brand-700 ring-2 ring-brand-600'
                      : 'bg-white text-slate-400 ring-1 ring-slate-300',
                ].join(' ')}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isComplete ? <CheckIcon /> : i + 1}
              </div>
              <span
                className={[
                  'max-w-[6.5rem] text-center text-[11px] font-medium leading-tight sm:text-xs',
                  isCurrent ? 'text-brand-800' : isComplete ? 'text-slate-600' : 'text-slate-400',
                ].join(' ')}
              >
                {step.label}
              </span>
            </div>
            {i !== steps.length - 1 && (
              <div
                className={`mt-4 h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                  isComplete ? 'bg-brand-600' : 'bg-slate-200'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
