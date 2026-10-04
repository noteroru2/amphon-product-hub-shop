export interface HubRoute {
  tab: string;
  draftId?: string;
  step?: number;
}

const KEY = 'amphonHubNavigation';

/** Session-scoped entries keep browser Back and the in-app arrow consistent. */
export function createHubNavigation(
  browser: Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>,
  initial: HubRoute,
  onChange: (route: HubRoute) => void,
  canLeave: () => boolean,
) {
  const session = crypto.randomUUID();
  const routes = [initial];
  let index = 0;
  const state = () => ({ ...browser.history.state, [KEY]: { session, index } });
  browser.history.replaceState(state(), '');
  const pop = (event: PopStateEvent) => {
    const target = event.state?.[KEY];
    if (target?.session !== session || !routes[target.index]) return;
    if (target.index === index) return;
    if (!canLeave()) {
      browser.history.go(index - target.index);
      return;
    }
    index = target.index;
    onChange(routes[index]);
  };
  browser.addEventListener('popstate', pop as EventListener);
  return {
    navigate(route: HubRoute) {
      if (!canLeave() || JSON.stringify(routes[index]) === JSON.stringify(route)) return;
      routes.splice(index + 1);
      routes.push(route);
      index += 1;
      browser.history.pushState(state(), '');
      onChange(route);
    },
    back() {
      if (!canLeave()) return;
      if (index > 0) browser.history.back();
      else onChange(routes[0]);
    },
    exitEditor() {
      if (!canLeave()) return;
      let target = index;
      while (target > 0 && routes[target].tab === 'add') target -= 1;
      if (target !== index) browser.history.go(target - index);
    },
    dispose() {
      browser.removeEventListener('popstate', pop as EventListener);
    },
  };
}
