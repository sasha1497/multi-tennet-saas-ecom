import { Redirect } from 'expo-router';

/**
 * `/cart` is a stack route so "Buy now" from a product page can push straight
 * to the bag; the bag itself lives in the tab navigator, so this simply hands
 * over rather than duplicating the screen.
 */
export default function CartRedirect() {
  return <Redirect href="/(shop)/bag" />;
}
