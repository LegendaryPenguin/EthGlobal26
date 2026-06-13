import { StoreProvider, useStore } from "./store";
import { Shell } from "./components/Shell";
import { Tokens } from "./screens/Tokens";
import { EarnList } from "./screens/EarnList";
import { DepositFlow } from "./screens/DepositFlow";
import { Activity } from "./screens/Activity";
import { Bridge } from "./screens/Bridge";
import { ConfirmModal } from "./components/ConfirmModal";
import { Login } from "./screens/Login";

function Routed() {
  const { state } = useStore();
  if (state.locked) return <Login />;
  let body: React.ReactNode = null;
  switch (state.tab) {
    case "tokens":
      body = <Tokens />;
      break;
    case "stake":
      body = state.step === "list" ? <EarnList /> : <DepositFlow />;
      break;
    case "bridge":
      body = <Bridge />;
      break;
    case "activity":
      body = <Activity />;
      break;
  }
  return (
    <Shell>
      <div className="app-screen" key={`${state.tab}-${state.step}`}>
        {body}
      </div>
      <ConfirmModal />
    </Shell>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Routed />
    </StoreProvider>
  );
}
