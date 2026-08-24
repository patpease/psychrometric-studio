/**
 * The guided walkthrough: sizing a cooling coil.
 *
 * One walkthrough, chosen because it is the spine of the tool — it passes
 * through mixing, the sensible heat ratio and the protractor, coil selection,
 * fan heat, the room load line, and finally the apparatus dew point. Someone
 * who finishes it has used most of what the application does, in the order a
 * real selection is actually made.
 *
 * ## How it drives the application
 *
 * Each step declares the system state it wants; the runner applies it on entry.
 * The steps are therefore **cumulative by construction rather than by
 * convention** — every step carries the full chain, so jumping back to step 3
 * restores step 3's system exactly, and there is no way for the sequence to
 * drift out of step with the chart.
 *
 * ## Units
 *
 * Authored in IP, which is this tool's primary system. The runner converts the
 * declared stages when the user is in SI, using the same conversion the unit
 * toggle uses — so there is one implementation of "what does 95 °F become", not
 * two that can disagree.
 */
import type { Stage } from '../types/project.js';
import type { FamilyKey } from '../chart/families.js';

export interface WalkthroughQuestion {
  readonly prompt: string;
  readonly options: readonly {
    readonly label: string;
    readonly correct?: boolean;
    /** Shown once chosen — right or wrong, both teach something. */
    readonly response: string;
  }[];
}

export interface WalkthroughStep {
  readonly id: string;
  readonly title: string;
  /** Paragraphs. Kept as an array so the renderer never parses prose. */
  readonly body: readonly string[];
  /** The system as this step wants it. Always the complete chain. */
  readonly stages: readonly Stage[];
  /** Which stage the panel and chart should focus on, by index. */
  readonly focus?: number;
  readonly showProtractor?: boolean;
  /** Line families to force on for this step. Others keep the user's setting. */
  readonly show?: readonly FamilyKey[];
  readonly question?: WalkthroughQuestion;
  /** Concepts to offer as links beside the step. */
  readonly concepts?: readonly string[];
}

export interface Walkthrough {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly icon: string;
  readonly steps: readonly WalkthroughStep[];
}

/* The chain, built up one stage at a time. Declared once and sliced, so a
   change to the coil in step 4 cannot fail to appear in steps 5 to 8. */
const OA: Stage = {
  id: 'wt-oa',
  type: 'source',
  name: 'Outdoor air',
  airflow: 500,
  params: { tdb: 95, rh: 0.4 },
};
const MIX: Stage = {
  id: 'wt-mix',
  type: 'mixing',
  name: 'Mixing box',
  params: { airflow2: 1500, tdb2: 75, rh2: 0.5 },
};
const COIL: Stage = {
  id: 'wt-coil',
  type: 'cooling',
  name: 'Cooling coil',
  params: { tdbOut: 54, rhOut: 0.93 },
};
const FAN: Stage = {
  id: 'wt-fan',
  type: 'fan',
  name: 'Supply fan',
  params: { power: 1.5, motorInAirstream: true },
};
const ROOM: Stage = {
  id: 'wt-room',
  type: 'room',
  name: 'Zone',
  params: { sensible: 42, latent: 11 },
};

const CHAIN = [OA, MIX, COIL, FAN, ROOM];

export const WALKTHROUGH: Walkthrough = {
  id: 'sizing-a-cooling-coil',
  title: 'Sizing a cooling coil',
  summary:
    'From a room load to a coil duty, in the order the selection is actually ' +
    'made. Introduces sensible heat ratio, the protractor, and apparatus dew point.',
  icon: 'cooling-coil',
  steps: [
    {
      id: 'brief',
      title: 'The brief',
      body: [
        'A single office zone. It is to be held at 75 °F and 50% RH, and at design ' +
          'condition it gains 42 MBH of sensible heat and 11 MBH of latent heat — ' +
          'people, lights, equipment, and the moisture the people bring with them.',
        'Outdoor air is at 95 °F dry bulb and 40% RH. We need 500 CFM of it for ' +
          'ventilation, and we will recirculate 1,500 CFM from the space — 2,000 ' +
          'CFM of supply air in total, a quarter of it fresh.',
        'The question this walkthrough answers is: what does the cooling coil have ' +
          'to do? Everything follows from those numbers, and the chart is how we ' +
          'get from one to the other.',
      ],
      stages: [OA],
      focus: 0,
      concepts: ['state-point', 'dry-bulb', 'relative-humidity'],
    },

    {
      id: 'outdoor-air',
      title: 'Start at the outdoor condition',
      body: [
        'The chart shows one point: 95 °F at 40% RH. Two properties were enough to ' +
          'fix it, and the tool has solved the other seven — read them in the ' +
          'Results panel. Its wet bulb comes out at 75.1 °F — worth noting, because ' +
          'that is the floor for anything evaporative — and its humidity ratio, ' +
          '0.0141 lb/lb, is what the coil will have to bring down.',
        'This point is the foundation of everything downstream, which is why the ' +
          'check on it is about the condition you chose rather than about the ' +
          'arithmetic. Peak dry bulb paired with peak wet bulb is a condition that ' +
          'essentially never happens — use the coincident pair.',
      ],
      stages: [OA],
      focus: 0,
      concepts: ['wet-bulb', 'humidity-ratio', 'dew-point'],
      question: {
        prompt: 'Outdoor air is warmed from 95 °F to 100 °F with no moisture added. What happens to its relative humidity?',
        options: [
          {
            label: 'It falls',
            correct: true,
            response:
              'Right. The same water is now in air that could hold more, so the ' +
              'fraction drops. Humidity ratio has not moved at all — which is why ' +
              'the chart puts W on the vertical axis and leaves RH as curves.',
          },
          {
            label: 'It rises',
            response:
              'Not quite. Nothing added moisture, so the numerator is unchanged ' +
              'while warmer air raises the denominator. RH falls. This is exactly ' +
              'what a heating coil does, and why heating dry winter air makes ' +
              'spaces feel arid.',
          },
          {
            label: 'It stays the same',
            response:
              'That would be true of humidity ratio, not relative humidity. RH is ' +
              'measured against what the air *could* hold, and that limit climbs ' +
              'steeply with temperature.',
          },
        ],
      },
    },

    {
      id: 'mixing',
      title: 'Mix outdoor air with return air',
      body: [
        'Return air comes back from the space at the room condition, 75 °F and 50% ' +
          'RH. It mixes with the outdoor air ahead of the coil, and the mixed state ' +
          'lands on the straight line between the two — positioned by the fraction ' +
          'of dry-air *mass* each stream contributes.',
        'That word matters. We have 500 CFM of outdoor air against 1,500 CFM of ' +
          'return, so it is tempting to put the mix point exactly a quarter of the ' +
          'way along. But 500 CFM of 95 °F air carries less dry-air mass than 500 ' +
          'CFM of 75 °F air would, so the true fraction is 24.2%, not 25%, and the ' +
          'mix point sits a shade closer to the return end than the volumes suggest.',
        'The mixed air lands at 79.9 °F. The tool works in mass throughout, so this ' +
          'is handled — but it is the most common hand-calculation error on the ' +
          'chart, and it always errs in the direction that flatters the ' +
          'outdoor-air percentage.',
      ],
      stages: [OA, MIX],
      focus: 1,
      concepts: ['lever-rule', 'specific-volume', 'mixing'],
    },

    {
      id: 'load-line',
      title: 'The space decides the direction',
      body: [
        'Before choosing anything about the coil, work out what the space needs. ' +
          'Sensible 42 MBH, latent 11 MBH, so the total is 53 and the room sensible ' +
          'heat ratio is 42 ÷ 53 = 0.79.',
        'That ratio is a direction on the chart. Turn on the SHR protractor in the ' +
          'Chart lines panel, read off the slope at 0.79, and transfer it through ' +
          'the room point at 75 °F / 50% RH. Any supply condition that can hold ' +
          'this space at setpoint must lie on that line, below and to the left of ' +
          'the room point.',
        'Note what is *not* a choice here. The designer picks the supply ' +
          'temperature and the airflow; the slope is handed to them by the loads.',
      ],
      stages: [OA, MIX],
      focus: 1,
      showProtractor: true,
      concepts: ['shr', 'protractor', 'latent-heat'],
      question: {
        prompt:
          'The space gains more people, so latent load rises from 11 to 20 MBH while sensible stays at 42. What happens to the room load line?',
        options: [
          {
            label: 'It gets steeper',
            correct: true,
            response:
              'Yes. SHR falls from 0.79 to 0.68, and a lower ratio tilts the line ' +
              'steeper as the latent share grows. The supply air now has to be ' +
              'drier to sit on it — which is a coil problem, not an airflow problem.',
          },
          {
            label: 'It gets flatter',
            response:
              'The other way round. Flatter means more of the load is sensible; ' +
              'SHR 1.0 is horizontal. Adding latent load lowers SHR and steepens ' +
              'the line.',
          },
          {
            label: 'It does not move — only the airflow changes',
            response:
              'The slope is set by the ratio of the two loads, so changing one of ' +
              'them changes the line. This is the case where more airflow does not ' +
              'help: it fixes temperature and leaves the space humid.',
          },
        ],
      },
    },

    {
      id: 'coil',
      title: 'Select the coil',
      body: [
        'Now choose a leaving condition on that line. 54 °F at 93% RH is a ' +
          'realistic chilled-water coil outcome, and it leaves about a 20 °F supply ' +
          'temperature difference — comfortably within what diffusers will throw.',
        'The 93% is not decoration. Air leaving a wet coil is close to saturated, ' +
          'because most of it has been in contact with a surface below its dew ' +
          'point. Typical is 90–95%. A leaving condition typed in at 70% RH is ' +
          'describing a coil that does not exist, and every duty calculated from ' +
          'it will be wrong.',
        'Look at the Results panel now. The coil is doing 75.5 MBH in total, and ' +
          'its own sensible heat ratio is 0.73 — not the room’s 0.79. The two are ' +
          'different jobs: the coil is also drying the outdoor air, a load the space ' +
          'never sees. Matching a coil to a room means understanding which ratio ' +
          'belongs to which.',
      ],
      stages: [OA, MIX, COIL],
      focus: 2,
      showProtractor: true,
      concepts: ['cooling', 'shr', 'relative-humidity'],
    },

    {
      id: 'fan',
      title: 'The fan is not free',
      body: [
        'A 1.5 HP supply fan puts its shaft power — and, with the motor in the ' +
          'airstream, its motor losses too — straight into the air as sensible ' +
          'heat. It shows as a short horizontal move to the right, typically half ' +
          'a degree to two degrees.',
        'It is small and it is routinely forgotten, after which the space runs warm ' +
          'at design load and nobody can find the missing capacity. Where you place ' +
          'it matters as well: draw-through puts the gain after the coil, so the ' +
          'coil never sees it; blow-through puts it before, and the coil has to ' +
          'remove it.',
        'Humidity ratio must not move across a fan. If it does, the model is wrong.',
      ],
      stages: [OA, MIX, COIL, FAN],
      focus: 3,
      concepts: ['fan', 'sensible-heat'],
    },

    {
      id: 'room',
      title: 'Close the loop at the space',
      body: [
        'Add the zone and the chain completes. Supply air enters at about 55.8 °F, ' +
          'absorbs the 42 MBH sensible and 11 MBH latent, and arrives at 75.7 °F and ' +
          '49.7% RH — within a degree of the 75 °F / 50% we specified at the start. ' +
          'That is what makes this a closed design rather than a sequence of ' +
          'guesses: the room the chain produces is the room we asked for.',
        'This is the test worth remembering: the room the chain produces should be ' +
          'the room you specified. If it comes out warmer, the airflow or the ' +
          'supply temperature is short. If it comes out at the right temperature ' +
          'but too humid, the supply air is not dry enough — and no amount of extra ' +
          'airflow will fix that.',
      ],
      stages: CHAIN,
      focus: 4,
      concepts: ['room', 'shr', 'comfort-zone'],
      question: {
        prompt:
          'The zone comes out at 75 °F but 58% RH instead of 50%. What is the fix?',
        options: [
          {
            label: 'A drier supply condition — lower the coil ADP',
            correct: true,
            response:
              'Correct. Temperature is right, so the sensible side is balanced; the ' +
              'shortfall is latent. A colder, deeper coil moves the supply point ' +
              'down onto the load line. Reheat may be needed afterwards to keep the ' +
              'sensible side from over-cooling.',
          },
          {
            label: 'More airflow',
            response:
              'This is the classic wrong answer, and it is wrong in an instructive ' +
              'way. More airflow at the same supply condition removes more sensible ' +
              'heat *and* more moisture in proportion — it slides along the same ' +
              'slope. The slope is what is wrong, not the length.',
          },
          {
            label: 'Raise the room setpoint',
            response:
              'That changes the target rather than meeting it, and at a fixed ' +
              'humidity ratio a warmer room reads as *lower* RH — so it would ' +
              'appear to help while the actual moisture in the space is unchanged.',
          },
        ],
      },
    },

    {
      id: 'adp',
      title: 'Where the coil line points',
      body: [
        'Select the cooling coil and look at the construction line the chart draws ' +
          'beyond it. Extended, the process line from entering to leaving air ' +
          'strikes the saturation curve, and that intersection is the apparatus dew ' +
          'point — the effective surface temperature of the coil.',
        'Here it lands at 51.3 °F. No real coil reaches its ADP: some air makes ' +
          'full contact with the fins and leaves at that condition, the rest slips ' +
          'between them and leaves unchanged, and what comes out is the mixture. ' +
          'The bypass factor — 0.096 here — is how much of it is the unchanged ' +
          'part. Roughly 0.15–0.25 is a four-row coil, 0.03–0.08 an eight-row, so ' +
          'this is a fairly deep selection.',
        'Now drop the leaving temperature toward 50 °F and watch which numbers ' +
          'move. The duty climbs from 75 to 95 MBH and the coil SHR falls from 0.73 ' +
          'to 0.67 — more of the work going into moisture. The ADP follows the air ' +
          'down, from 51.3 °F to 46.6 °F. The bypass factor barely shifts.',
        'That last part is the lesson. By specifying a leaving dry bulb *and* a ' +
          'leaving RH you have pinned the apparatus dew point, not the coil’s ' +
          'construction: bypass factor is what the geometry gives you, while ADP is ' +
          'what the chilled water has to deliver. An ADP of 46.6 °F needs colder ' +
          'water than most systems distribute. The chart will not stop you asking ' +
          'for it; it will only show you the bill.',
      ],
      stages: CHAIN,
      focus: 2,
      concepts: ['apparatus-dew-point', 'bypass-factor', 'saturation-curve'],
    },
  ],
};
