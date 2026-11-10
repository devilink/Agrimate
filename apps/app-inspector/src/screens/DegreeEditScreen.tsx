import { useNav } from '../lib/nav';
import { Screen } from '../lib/ui';
import { OnboardingForm } from './OnboardingScreen';

export function DegreeEditScreen() {
  const nav = useNav();
  return <Screen title="Send your degree again"><OnboardingForm onSubmitted={nav.pop} /></Screen>;
}
