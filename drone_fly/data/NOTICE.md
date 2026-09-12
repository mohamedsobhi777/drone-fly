# MaleCNS circuit data

Measured source: MaleCNS v1.0, minimum confidence 0.5. Data creators: FlyEM / HHMI Janelia, University of Cambridge, MRC Laboratory of Molecular Biology, Google Research. License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Dataset](https://male-cns.janelia.org/download/).

This is the unchanged 80-cell / 1,296-edge / 26,029-contact extract published in [Fly Dino by Mert Cobanov](https://github.com/cobanov/flyjump/tree/c08c86bc18efd8125964b1d2ca4fc1df59700f30/public/data/connectome). Graph SHA-256: `2424c9dd2e44534e600aeda1a9058039b1f22a4bd983284a27adc10b22130719`.

The accompanying manifest describes the upstream extraction, not Drone Fly's model. Reproduce the extract using the pinned upstream [builder](https://github.com/cobanov/flyjump/blob/c08c86bc18efd8125964b1d2ca4fc1df59700f30/scripts/build-connectome.py) and [protocol](https://github.com/cobanov/flyjump/blob/c08c86bc18efd8125964b1d2ca4fc1df59700f30/docs/experiment.md).

Drone Fly assigns engineered camera/velocity channels to input cells and fits an artificial navigation readout. Source anatomy is unchanged. Runtime assumptions are in `docs/METHODS.md` at the repository root. No biological fidelity or upstream endorsement is implied.
