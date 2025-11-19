import { render } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

const queryClient = new QueryClient();

type QueryProviderProps = {
  children: ComponentChildren;
  client: QueryClient;
};

const PreactQueryClientProvider = QueryClientProvider as unknown as (props: QueryProviderProps) => VNode;

render(
  <PreactQueryClientProvider client={queryClient}>
    <App />
  </PreactQueryClientProvider>,
  document.getElementById('app')!
);
