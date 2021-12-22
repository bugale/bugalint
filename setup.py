"""Setup script for bugalint"""

from setuptools import setup  # type: ignore

with open('README.md', encoding='utf-8') as file:
    readme = file.read()

setup(
    name='bugalint',
    version='4.0.0',
    url='https://github.com/bugale/bugalint',
    license='MIT',
    author='Bugale',
    author_email='bugale@bugalit.com',
    description='An abstraction package for running linters on code, outputting the results in a unified format.',
    long_description=readme,
    long_description_content_type='text/markdown',
    packages=['bugalint'],
    package_data={'': ['*.ini']},
    zip_safe=False,
    platforms='any',
    install_requires=[],
    extras_require={'dev': ['pylint', 'flake8', 'mypy']},
    entry_points={
        'console_scripts': [
            'bugalint = bugalint.cli:main',
        ],
    },
    classifiers=[
        'Development Status :: 5 - Production/Stable',
        'Environment :: Console',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: MIT License',
        'Operating System :: POSIX',
        'Operating System :: MacOS',
        'Operating System :: Unix',
        'Operating System :: Microsoft :: Windows',
        'Programming Language :: Python',
        'Programming Language :: Python :: 3.7',
        'Programming Language :: Python :: 3.8',
        'Programming Language :: Python :: 3.9',
        'Programming Language :: Python :: 3.10',
        'Topic :: Software Development :: Libraries :: Python Modules',
        'Topic :: Software Development :: Quality Assurance',
    ]
)
