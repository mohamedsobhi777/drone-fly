# Implementation and acceptance plan

## Product
A runnable local flight laboratory with MuJoCo quadcopter physics, drone camera, interactive 3D course and trajectory, measured MaleCNS circuit visualization, live interventions, trainable readout, and reproducible comparison experiments. Simulation is the first release. Physical flight needs a selected drone and flight validation and is not claimed by this release.

## Milestones
1. Reproducible environment, private GitHub repository, measured graph provenance.
2. Six-degree-of-freedom quadcopter, four thrust actuators, conventional stabilization, seeded gates/obstacles, collision and completion metrics, actual camera images.
3. Camera feature encoder, measured connectome dynamics, learned readout, matched rewired/random-feature controls and conventional visual-servo baseline. Train and evaluate on separated course seeds. Publish measured results without assuming topology superiority.
4. Browser workbench: 3D world, onboard camera, circuit activity, flight controls, seeded missions, interventions, telemetry, recording/replay and downloadable results. Long computations must be cancellable and not freeze the UI.
5. Tests covering physics, sensory causality, graph provenance, learned parameter use, deterministic courses, scoring, data contracts and experiment comparisons. Browser desktop/mobile inspection and interaction checks. Complete README and methods, CI, clean commits pushed to private origin.

## Design
Dark industrial flight-test workbench; red/orange accents, sharp grid, readable data typography. Every displayed value comes from actual simulation or recorded experiment data. Scientific scope and attribution remain accessible.

## Initial learning method
Supervised imitation of an explicit visual-servo teacher with a trainable readout, followed by closed-loop evaluation. This trains navigation, not biological synapses. Compare all learned feature substrates with the same dataset, training budget and evaluation seeds. Document camera preprocessing and stabilization; no claim of raw-pixel biological vision or onboard deployment.

## Completion evidence
Working local launch, evaluated checkpoint, comparisons, tested interventions, functional recording/replay, successful browser verification, passing automated checks, incremental Git commits and private GitHub visibility.
