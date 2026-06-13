import { useStore } from "../store";
import { BridgeCard } from "../components/BridgeCard";
import { Button } from "../components/ui";

// Bridge tab — generic any-token/any-chain → Arc surface (reuses the deposit bridge card).
// Decorative entry point; the real money path lives in Earn. DESIGN_SPEC §4.
export function Bridge() {
  const { dispatch } = useStore();
  return (
    <div className="flow-narrow">
      <h1 className="t-heading-md page-title">Bridge</h1>
      <p className="t-body-sm text-alt" style={{ margin: "0 0 16px" }}>
        Move any token from any chain into USDC on Arc.
      </p>
      <BridgeCard mode="amount" />
      <Button
        full
        size="lg"
        style={{ marginTop: 20 }}
        onClick={() => {
          dispatch({ type: "tab", tab: "stake" });
          dispatch({ type: "step", step: "tranche" });
        }}
      >
        Bridge & Earn with Vouch
      </Button>
    </div>
  );
}
